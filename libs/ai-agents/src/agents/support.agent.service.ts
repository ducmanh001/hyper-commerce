// ============================================================
// HYPERCOMMERCE — Customer Support Agent Service
//
// LLM-powered customer support with:
//   - Conversation memory (Redis)
//   - Knowledge base retrieval (Qdrant RAG)
//   - Tool use: order lookup, refund initiation, FAQ
//   - Human escalation on complex issues
//   - Bilingual: Vietnamese + English
//
// Uses gpt-4o for accurate reasoning on order/payment issues.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { AgentTask, AgentResult, SupportTaskInput, SupportTaskOutput } from '../types';
import { AgentType, TaskStatus } from '../types';
import type { RedisMemoryService } from '../memory/redis-memory.service';
import type { VectorMemoryService } from '../memory/vector-memory.service';
import type { EpisodicMemoryService } from '../memory/episodic-memory.service';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class SupportAgentService {
  private readonly logger = new Logger(SupportAgentService.name);
  private openai: OpenAI;

  private readonly ESCALATION_KEYWORDS = [
    'luật sư',
    'tòa án',
    'báo chí',
    'kiện', // VN legal threats
    'lawyer',
    'lawsuit',
    'court',
    'sue', // EN legal threats
    'gian lận',
    'lừa đảo',
    'hack', // fraud claims
  ];

  constructor(
    private readonly config: ConfigService,
    private readonly memory: RedisMemoryService,
    private readonly vectorMemory: VectorMemoryService,
    private readonly episodic: EpisodicMemoryService,
  ) {
    this.openai = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY'),
    });
  }

  async respond(task: AgentTask<SupportTaskInput>): Promise<AgentResult<SupportTaskOutput>> {
    const start = Date.now();
    const { input } = task;

    // Check for immediate escalation triggers
    if (this.requiresImmediateEscalation(input.message)) {
      return this.buildResult(task, start, {
        reply:
          input.language === 'vi'
            ? 'Xin lỗi về sự bất tiện này. Tôi đang chuyển bạn đến nhân viên hỗ trợ chuyên biệt ngay bây giờ.'
            : 'I apologize for the inconvenience. I am transferring you to a specialized support agent right now.',
        intent: 'escalation_required',
        actionsPerformed: ['escalated_to_human'],
        escalatedToHuman: true,
      });
    }

    // Retrieve relevant knowledge (RAG)
    const knowledgeDocs = await this.vectorMemory.search(input.message, 'agent_knowledge', 3, 0.7);

    const knowledgeContext =
      knowledgeDocs.length > 0
        ? `\n\nRelevant knowledge:\n${knowledgeDocs.map((d) => d.content).join('\n---\n')}`
        : '';

    // Build messages
    const systemPrompt = this.buildSystemPrompt(input.language, knowledgeContext);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...input.history.slice(-8).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: input.message },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        max_tokens: 500,
        temperature: 0.3, // low temperature for consistent support responses
      });

      const reply = response.choices[0].message.content ?? '';
      const tokensUsed = response.usage?.total_tokens ?? 0;

      // Save to conversation memory
      await this.memory.appendMessage(AgentType.SUPPORT, input.sessionId, {
        role: 'user',
        content: input.message,
        timestamp: new Date().toISOString(),
      });
      await this.memory.appendMessage(AgentType.SUPPORT, input.sessionId, {
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
        tokensUsed,
      });

      return this.buildResult(
        task,
        start,
        {
          reply,
          intent: this.detectIntent(input.message),
          actionsPerformed: [],
          escalatedToHuman: false,
        },
        TaskStatus.COMPLETED,
        tokensUsed,
      );
    } catch (err) {
      this.logger.error('Support agent LLM error', err);
      return this.buildResult(
        task,
        start,
        {
          reply:
            input.language === 'vi'
              ? 'Xin lỗi, tôi gặp sự cố kỹ thuật. Vui lòng thử lại sau hoặc liên hệ hotline.'
              : 'Sorry, I encountered a technical issue. Please try again or contact our hotline.',
          intent: 'error',
          actionsPerformed: [],
          escalatedToHuman: true,
        },
        TaskStatus.FAILED,
      );
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private buildSystemPrompt(language: 'vi' | 'en', knowledge: string): string {
    const base =
      language === 'vi'
        ? `Bạn là trợ lý hỗ trợ khách hàng của HyperCommerce, một sàn thương mại điện tử hàng đầu Việt Nam.
Hãy trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp.
Nếu không biết câu trả lời, hãy thành thật và đề nghị chuyển đến nhân viên hỗ trợ.
Không bịa đặt thông tin về đơn hàng hay chính sách.`
        : `You are a customer support assistant for HyperCommerce, a leading Vietnamese e-commerce platform.
Be friendly, professional, and helpful.
If you don't know the answer, be honest and offer to escalate to a human agent.
Never fabricate order information or policies.`;

    return `${base}${knowledge}`;
  }

  private requiresImmediateEscalation(message: string): boolean {
    const lower = message.toLowerCase();
    return this.ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
  }

  private detectIntent(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('đơn hàng') || lower.includes('order')) return 'order_inquiry';
    if (lower.includes('hoàn tiền') || lower.includes('refund')) return 'refund_request';
    if (lower.includes('giao hàng') || lower.includes('delivery')) return 'delivery_inquiry';
    if (lower.includes('đổi') || lower.includes('return')) return 'return_request';
    if (lower.includes('thanh toán') || lower.includes('payment')) return 'payment_inquiry';
    return 'general_inquiry';
  }

  private buildResult(
    task: AgentTask<SupportTaskInput>,
    startMs: number,
    output: SupportTaskOutput,
    status = TaskStatus.COMPLETED,
    tokensUsed = 0,
  ): AgentResult<SupportTaskOutput> {
    return {
      taskId: task.taskId,
      type: AgentType.SUPPORT,
      status,
      output,
      toolCallsCount: 1,
      tokensUsed,
      durationMs: Date.now() - startMs,
      completedAt: new Date().toISOString(),
    };
  }
}
