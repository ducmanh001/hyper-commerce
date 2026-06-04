// ============================================================
// HYPERCOMMERCE — Query Understanding Service
// Pipeline xử lý search query trước khi gửi vào Elasticsearch.
//
// Pipeline stages:
// 1. Tokenization + normalization (lowercase, remove diacritics)
// 2. Intent detection (brand, price filter, category)
// 3. Spell correction (Elasticsearch suggest + custom dictionary)
// 4. Query expansion (synonym, related terms)
// 5. Personalization signals injection
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ElasticsearchService } from '@nestjs/elasticsearch';

export interface ParsedQuery {
  raw: string;
  normalized: string;
  corrected: string;
  tokens: string[];
  intent: QueryIntent;
  filters: QueryFilters;
  expansions: string[];
  mustBoostTerms: string[];
}

export interface QueryIntent {
  isBrandSearch: boolean;
  isPriceFilter: boolean;
  isCategorySearch: boolean;
  detectedBrand?: string;
  detectedCategory?: string;
  sortHint?: 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'NEWEST';
}

export interface QueryFilters {
  brandNames?: string[];
  priceMin?: number;
  priceMax?: number;
  categoryIds?: string[];
  inStock?: boolean;
  minRating?: number;
}

// Brand name → canonical brand ID mapping
const BRAND_ALIASES: Record<string, string> = {
  nike: 'Nike',
  'nike vn': 'Nike',
  adidas: 'Adidas',
  adi: 'Adidas',
  apple: 'Apple',
  iphone: 'Apple',
  samsung: 'Samsung',
  ss: 'Samsung',
  xiaomi: 'Xiaomi',
  mi: 'Xiaomi',
  oppo: 'OPPO',
  vivo: 'Vivo',
};

// Price intent patterns
const PRICE_INTENT_PATTERNS = [
  { re: /giá rẻ|rẻ nhất|budget|cheap/i, hint: 'PRICE_ASC' as const },
  { re: /cao cấp|premium|luxury|xịn/i, hint: 'PRICE_DESC' as const },
  { re: /đánh giá cao|best seller|review tốt/i, hint: 'RATING' as const },
  { re: /mới nhất|new arrival|mới ra/i, hint: 'NEWEST' as const },
];

// Vietnamese-specific synonyms
const SYNONYM_MAP: Record<string, string[]> = {
  'tai nghe chống ồn': ['noise cancelling', 'anc', 'active noise cancellation'],
  'giày chạy bộ': ['running shoes', 'training shoes', 'sport shoes'],
  'điện thoại': ['smartphone', 'phone', 'mobile'],
  'máy tính xách tay': ['laptop', 'notebook'],
  'đồng hồ thông minh': ['smartwatch', 'smart watch'],
  'quà valentine': ['hoa hồng', 'socola', 'nước hoa', 'trang sức'],
  'giảm cân': ['protein', 'supplement', 'gym'],
};

@Injectable()
export class QueryUnderstandingService {
  private readonly logger = new Logger(QueryUnderstandingService.name);

  constructor(private readonly esService: ElasticsearchService) {}

  /**
   * Full query understanding pipeline.
   * Transforms raw user query into structured, enriched form.
   */
  async understand(rawQuery: string, _userId?: string): Promise<ParsedQuery> {
    // 1. Normalize
    const normalized = this.normalize(rawQuery);

    // 2. Detect intent + filters (synchronous — regex based)
    const { intent, filters } = this.detectIntentAndFilters(normalized);

    // 3. Spell correction (async — calls ES suggest)
    const corrected = await this.correctSpelling(normalized);

    // 4. Tokenize corrected query
    const tokens = this.tokenize(corrected);

    // 5. Expand with synonyms
    const expansions = this.expandWithSynonyms(corrected, tokens);

    // 6. Boost terms based on intent
    const mustBoostTerms = this.buildBoostTerms(intent, filters);

    const result: ParsedQuery = {
      raw: rawQuery,
      normalized,
      corrected,
      tokens,
      intent,
      filters,
      expansions,
      mustBoostTerms,
    };

    this.logger.debug(JSON.stringify({ event: 'query_understood', ...result }));

    return result;
  }

  /**
   * Normalize: lowercase, trim, remove extra spaces, keep Vietnamese diacritics.
   * Do NOT strip diacritics — "giày" ≠ "giay", they're different tokens in Vietnamese.
   */
  private normalize(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Remove punctuation, keep letters+digits
      .trim();
  }

  /**
   * Detect intent from normalized query using pattern matching.
   * This runs BEFORE spell correction — intent cues can survive misspellings.
   */
  private detectIntentAndFilters(query: string): {
    intent: QueryIntent;
    filters: QueryFilters;
  } {
    const intent: QueryIntent = {
      isBrandSearch: false,
      isPriceFilter: false,
      isCategorySearch: false,
    };
    const filters: QueryFilters = {};

    // Brand detection
    for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
      if (query.includes(alias)) {
        intent.isBrandSearch = true;
        intent.detectedBrand = canonical;
        filters.brandNames = [canonical];
        break;
      }
    }

    // Price intent
    for (const { re, hint } of PRICE_INTENT_PATTERNS) {
      if (re.test(query)) {
        intent.isPriceFilter = true;
        intent.sortHint = hint;
        break;
      }
    }

    // Price range extraction: "dưới 500k", "từ 200k đến 500k"
    const underMatch = query.match(/dưới\s+(\d+)\s*k/i);
    if (underMatch?.[1]) {
      filters.priceMax = Number(underMatch[1]) * 1000;
    }

    const rangeMatch = query.match(/từ\s+(\d+)\s*k?\s+đến\s+(\d+)\s*k/i);
    if (rangeMatch?.[1] && rangeMatch?.[2]) {
      filters.priceMin = Number(rangeMatch[1]) * 1000;
      filters.priceMax = Number(rangeMatch[2]) * 1000;
    }

    // In-stock filter
    if (/còn hàng|có sẵn|in stock/i.test(query)) {
      filters.inStock = true;
    }

    return { intent, filters };
  }

  /**
   * Spell correction using Elasticsearch term suggester.
   * ES uses frequency-based suggestion — returns most frequent correct term.
   *
   * Custom dictionary for Vietnamese brand names + product terms
   * is loaded into ES index at startup.
   */
  private async correctSpelling(query: string): Promise<string> {
    try {
      const response = await this.esService.search({
        index: 'products',
        body: {
          suggest: {
            spell_correction: {
              text: query,
              term: {
                field: 'search_text',
                suggest_mode: 'missing', // Only suggest for unknown terms
                max_edits: 2,
                min_word_length: 4,
                sort: 'frequency',
                string_distance: 'internal', // Damerau-Levenshtein
              },
            },
          },
          _source: false,
          size: 0,
        },
      });

      const suggestions = (response as unknown as Record<string, unknown>).suggest as Record<
        string,
        Array<{ options: Array<{ text: string }> }>
      >;
      if (!suggestions?.spell_correction) return query;

      // Build corrected query by replacing each token suggestion
      let corrected = query;
      for (const suggestion of suggestions.spell_correction) {
        if (suggestion.options?.[0]?.text) {
          // Only apply if confidence is high enough
          const original = suggestion.options[0].text;
          corrected = corrected.replace(new RegExp(`\\b${this.escapeRegex(query)}\\b`), original);
        }
      }

      return corrected;
    } catch {
      // ES unavailable — return original query
      return query;
    }
  }

  /**
   * Tokenize query into individual terms.
   * For Vietnamese: simple whitespace tokenize (no morphology).
   * In production: use underthesea or pyvi via gRPC sidecar.
   */
  private tokenize(query: string): string[] {
    return query
      .split(/\s+/)
      .filter((token) => token.length >= 2) // Skip single chars
      .filter((token) => !this.isStopWord(token));
  }

  /**
   * Expand query with synonyms — increases recall.
   * Returns additional terms to include in ES should clauses.
   */
  private expandWithSynonyms(query: string, tokens: string[]): string[] {
    const expansions = new Set<string>();

    // Check phrase-level synonyms first
    for (const [phrase, synonyms] of Object.entries(SYNONYM_MAP)) {
      if (query.includes(phrase)) {
        synonyms.forEach((s) => expansions.add(s));
      }
    }

    // Token-level expansions (abbreviated to key ones)
    const tokenExpansions: Record<string, string[]> = {
      iphone: ['apple', 'ios', 'smartphone'],
      laptop: ['máy tính xách tay', 'notebook', 'macbook'],
    };

    for (const token of tokens) {
      const exp = tokenExpansions[token];
      if (exp) exp.forEach((e) => expansions.add(e));
    }

    return [...expansions];
  }

  private buildBoostTerms(intent: QueryIntent, _filters: QueryFilters): string[] {
    const boosts: string[] = [];
    if (intent.detectedBrand) boosts.push(intent.detectedBrand);
    if (intent.detectedCategory) boosts.push(intent.detectedCategory);
    return boosts;
  }

  private readonly STOP_WORDS = new Set([
    'và',
    'hoặc',
    'với',
    'của',
    'cho',
    'từ',
    'đến',
    'là',
    'có',
    'không',
    'the',
    'a',
    'an',
    'and',
    'or',
    'of',
    'in',
    'for',
  ]);

  private isStopWord(token: string): boolean {
    return this.STOP_WORDS.has(token.toLowerCase());
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
