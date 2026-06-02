// apps/search-service/src/suggest/autocomplete.service.ts
// Trie-based autocomplete with Redis persistence.
// Hot path: Redis GET on every keystroke.
// Cold start / rebuild: load from Trie in memory (snapshot persisted).

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '@hypercommerce/redis';
import { Trie, CompactTrieSerializer } from '@hypercommerce/algorithms';
import {
  SEARCH_CACHE_TTL,
  SEARCH_CACHE_KEYS,
  SEARCH_LIMITS,
} from '../constants/search.constants';

export interface AutocompleteSuggestion {
  text: string;
  frequency: number;
  type: 'keyword' | 'product' | 'category' | 'brand';
}

@Injectable()
export class AutocompleteService implements OnModuleInit {
  private readonly logger = new Logger(AutocompleteService.name);
  private trie = new Trie();
  private isReady = false;

  constructor(
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadTrieFromRedis();
  }

  /**
   * Get autocomplete suggestions for a prefix.
   * 1. Try Redis SET cache (fastest, O(1))
   * 2. Fall back to in-memory Trie (still fast, O(k log m))
   */
  async suggest(
    prefix: string,
    limit: number = SEARCH_LIMITS.AUTOCOMPLETE_LIMIT,
  ): Promise<AutocompleteSuggestion[]> {
    if (!prefix || prefix.length < 1) return [];
    const normalized = prefix.toLowerCase().trim();

    // Try Redis cache first
    const cacheKey = SEARCH_CACHE_KEYS.autocomplete(normalized);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Ignore parse error, fall through to trie
      }
    }

    // In-memory trie lookup
    if (!this.isReady) {
      return [];
    }

    const trieResults = this.trie.autocomplete(normalized, limit);

    const suggestions: AutocompleteSuggestion[] = trieResults.map((r: { term: string; frequency: number }) => ({
      text: r.term,
      frequency: r.frequency,
      type: 'keyword' as const,
    }));

    // Cache results
    await this.redis.set(
      cacheKey,
      JSON.stringify(suggestions),
      SEARCH_CACHE_TTL.AUTOCOMPLETE,
    );

    return suggestions;
  }

  /**
   * Fuzzy autocomplete for typo tolerance.
   * Slightly slower (O(n × k) where n = trie nodes) — use only when
   * exact prefix returns empty results.
   */
  async fuzzySearch(
    query: string,
    maxDistance = 2,
    limit = SEARCH_LIMITS.AUTOCOMPLETE_LIMIT,
  ): Promise<AutocompleteSuggestion[]> {
    if (!this.isReady) return [];
    const normalized = query.toLowerCase().trim();

    const results = this.trie.fuzzySearch(normalized, maxDistance, limit);
    return results.map((r: { term: string; frequency: number }) => ({
      text: r.term,
      frequency: r.frequency,
      type: 'keyword' as const,
    }));
  }

  /**
   * Record a successful search query to boost autocomplete frequency.
   * Call this when user submits a search (not on every keystroke).
   */
  async recordQuery(query: string, frequency = 1): Promise<void> {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return;

    // Update in-memory trie
    this.trie.insert(normalized, frequency);

    // Persist snapshot to Redis (debounced — do every N queries in production)
    await this.persistTrieSnapshot();
  }

  /**
   * Bulk load terms from query log (runs at startup / nightly).
   */
  async bulkLoad(terms: Array<{ term: string; frequency: number }>): Promise<void> {
    const trie = new Trie();
    for (const { term, frequency } of terms) {
      trie.insert(term.toLowerCase(), frequency);
    }
    this.trie = trie;
    this.isReady = true;
    this.logger.log(`Trie loaded with ${terms.length} terms`);
    await this.persistTrieSnapshot();
  }

  private async loadTrieFromRedis(): Promise<void> {
    try {
      const snapshot = await this.redis.get(SEARCH_CACHE_KEYS.trieSnapshot());
      if (snapshot) {
        this.trie = CompactTrieSerializer.deserialize(snapshot);
        this.isReady = true;
        this.logger.log('Trie snapshot loaded from Redis');
      } else {
        this.logger.warn('No trie snapshot in Redis — starting empty');
        this.isReady = true;
      }
    } catch (err) {
      this.logger.error('Failed to load trie from Redis', err);
      this.isReady = true; // Still serve with empty trie
    }
  }

  private async persistTrieSnapshot(): Promise<void> {
    try {
      const snapshot = CompactTrieSerializer.serialize(this.trie);
      await this.redis.set(
        SEARCH_CACHE_KEYS.trieSnapshot(),
        snapshot,
        SEARCH_CACHE_TTL.TRIE_SNAPSHOT,
      );
    } catch (err) {
      this.logger.warn('Failed to persist trie snapshot', err);
    }
  }
}
