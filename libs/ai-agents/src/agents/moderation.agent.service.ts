import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  AgentTask,
  AgentResult,
  ModerationTaskInput,
  ModerationTaskOutput,
  ContentType,
} from '../types';
import { AgentType, TaskStatus } from '../types';

// Toxicity categories to detect
const MODERATION_SYSTEM_PROMPT = `You are a content moderation AI for HyperCommerce, a Vietnamese e-commerce platform.
Analyze the provided content and return a JSON object with:
{
  "decision": "APPROVED" | "FLAGGED" | "REJECTED",
  "toxicityScore": 0.0-1.0,
  "categories": array of triggered categories from: ["spam", "offensive", "prohibited_goods", "misleading", "adult"],
  "flaggedSpans": [{"text": "...", "category": "...", "start": 0, "end": 10}],
  "reasoning": "brief explanation"
}

Rules:
- REJECTED: adult content, prohibited goods (weapons/drugs), hate speech → score > 0.85
- FLAGGED: potential spam, misleading claims, borderline content → score 0.5-0.85
- APPROVED: normal commerce content → score < 0.5
- Vietnamese and English text both supported
- Be strict about prohibited goods (thuốc lá điện tử, vũ khí, chất kích thích)
- Be lenient about normal product descriptions and reviews`;

// Hard-coded pattern guards (no LLM cost, <1ms)
const PROHIBITED_PATTERNS = [
  /\b(ma túy|heroin|cocaine|meth|thuốc phiện)\b/i,
  /\b(súng|vũ khí|đạn|dao tự chế)\b/i,
  /\b(cờ bạc|casino online|cá độ)\b/i,
  /\b(invoice hack|phishing|scam)\b/i,
];

const SPAM_PATTERNS = [
  /(.)\1{5,}/, // Repeated characters: "aaaaaaa"
  /(https?:\/\/[^\s]+\s*){3,}/i, // 3+ URLs
  /[\u{1F600}-\u{1F9FF}]{10,}/u, // 10+ consecutive emojis
];

@Injectable()
export class ContentModerationAgentService {
  private readonly logger = new Logger(ContentModerationAgentService.name);
  private readonly openai: OpenAI;
  /** Cache of recently moderated content hashes → result */
  private readonly cache = new Map<string, ModerationTaskOutput>();

  // GPT-4o-mini: ~50× cheaper than GPT-4o, sufficient for classification
  private readonly MODEL = 'gpt-4o-mini';
  private readonly CACHE_SIZE = 500;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: this.config.get<string>('OPENAI_API_KEY') });
  }

  async moderate(task: AgentTask<ModerationTaskInput>): Promise<AgentResult<ModerationTaskOutput>> {
    const start = Date.now();

    try {
      const input = task.input;
      const cacheKey = this.hashContent(input.text, input.contentType);

      // 1. Cache hit
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return this.result(task, cached, start, 0);
      }

      // 2. Hard pattern check — instant, no LLM cost
      const hardResult = this.checkHardPatterns(input);
      if (hardResult.decision === 'REJECTED') {
        this.setCache(cacheKey, hardResult);
        return this.result(task, hardResult, start, 0);
      }

      // 3. GPT-4o-mini for nuanced classification
      const prompt = this.buildPrompt(input);
      const completion = await this.openai.chat.completions.create({
        model: this.MODEL,
        messages: [
          { role: 'system', content: MODERATION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 400,
      });

      const raw = JSON.parse(completion.choices[0].message.content ?? '{}');
      const output: ModerationTaskOutput = {
        decision: raw.decision ?? 'FLAGGED',
        toxicityScore: raw.toxicityScore ?? 0.5,
        categories: raw.categories ?? [],
        flaggedSpans: raw.flaggedSpans ?? [],
        requiresHumanReview: (raw.toxicityScore ?? 0.5) >= 0.5 && raw.decision !== 'REJECTED',
      };

      this.setCache(cacheKey, output);
      this.logger.log({
        contentId: input.contentId,
        contentType: input.contentType,
        decision: output.decision,
        score: output.toxicityScore,
        durationMs: Date.now() - start,
      });

      return this.result(task, output, start, completion.usage?.total_tokens ?? 0);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Moderation failed for ${task.input.contentId}`, err.stack);
      // Fail safe: flag for human review on error
      const fallback: ModerationTaskOutput = {
        decision: 'FLAGGED',
        toxicityScore: 0.5,
        categories: [],
        flaggedSpans: [],
        requiresHumanReview: true,
      };
      return this.result(task, fallback, start, 0, err.message);
    }
  }

  /**
   * Batch moderation — more efficient for product catalog ingestion
   */
  async moderateBatch(
    items: Array<Pick<ModerationTaskInput, 'contentId' | 'contentType' | 'text'>>,
    language: 'vi' | 'en' | 'auto' = 'auto',
  ): Promise<Array<{ contentId: string; output: ModerationTaskOutput }>> {
    // Process in parallel (max 5 concurrent to respect rate limits)
    const BATCH_SIZE = 5;
    const results: Array<{ contentId: string; output: ModerationTaskOutput }> = [];

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const task: AgentTask<ModerationTaskInput> = {
            taskId: `batch-${item.contentId}`,
            type: AgentType.MODERATION,
            priority: 2,
            input: { ...item, language },
            correlationId: item.contentId,
            createdAt: new Date().toISOString(),
            timeoutMs: 5000,
            retryCount: 0,
          };
          const result = await this.moderate(task);
          return { contentId: item.contentId, output: result.output! };
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }

  // ── Private helpers ────────────────────────────────────────

  private checkHardPatterns(input: ModerationTaskInput): ModerationTaskOutput {
    for (const pattern of PROHIBITED_PATTERNS) {
      if (pattern.test(input.text)) {
        const match = input.text.match(pattern);
        return {
          decision: 'REJECTED',
          toxicityScore: 1.0,
          categories: ['prohibited_goods'],
          flaggedSpans: match
            ? [
                {
                  text: match[0],
                  category: 'prohibited_goods',
                  start: input.text.indexOf(match[0]),
                  end: input.text.indexOf(match[0]) + match[0].length,
                },
              ]
            : [],
          requiresHumanReview: false,
        };
      }
    }

    let spamScore = 0;
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(input.text)) spamScore += 0.3;
    }

    if (spamScore >= 0.6) {
      return {
        decision: 'FLAGGED',
        toxicityScore: spamScore,
        categories: ['spam'],
        flaggedSpans: [],
        requiresHumanReview: true,
      };
    }

    return {
      decision: 'APPROVED',
      toxicityScore: 0,
      categories: [],
      flaggedSpans: [],
      requiresHumanReview: false,
    };
  }

  private buildPrompt(input: ModerationTaskInput): string {
    const typeLabel: Record<ContentType, string> = {
      product_title: 'product title',
      product_description: 'product description',
      review: 'customer review',
      live_chat: 'live stream chat message',
      seller_bio: 'seller profile bio',
    };
    return `Content type: ${typeLabel[input.contentType]}\nLanguage: ${input.language}\n\nContent to moderate:\n${input.text}`;
  }

  private hashContent(text: string, type: string): string {
    // Simple FNV-1a hash — no crypto overhead
    let hash = 2166136261;
    const combined = `${type}:${text}`;
    for (let i = 0; i < combined.length; i++) {
      hash ^= combined.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16);
  }

  private setCache(key: string, value: ModerationTaskOutput): void {
    if (this.cache.size >= this.CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  private result(
    task: AgentTask<ModerationTaskInput>,
    output: ModerationTaskOutput,
    start: number,
    tokens: number,
    error?: string,
  ): AgentResult<ModerationTaskOutput> {
    return {
      taskId: task.taskId,
      type: AgentType.MODERATION,
      status: error ? TaskStatus.FAILED : TaskStatus.COMPLETED,
      output: error ? undefined : output,
      error,
      toolCallsCount: 0,
      tokensUsed: tokens,
      durationMs: Date.now() - start,
      completedAt: new Date().toISOString(),
    };
  }
}
