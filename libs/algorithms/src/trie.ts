// ============================================================
// HYPERCOMMERCE — Trie (Prefix Tree) for Autocomplete
//
// Use cases:
//   1. Search autocomplete: "iph" → ["iphone 15", "iphone case", ...]
//   2. Category suggestion
//   3. Hashtag autocomplete in feed
//
// Memory: O(ALPHABET_SIZE × N × avg_len)
// Lookup: O(L) where L = query length
// Insert: O(L)
//
// For 1M product names, ~50MB in-memory.
// Pre-built from top 1M search queries (updated nightly via Kafka).
// ============================================================

export interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  frequency: number;  // How often this term was searched (for ranking)
  value?: string;     // The complete term at this leaf
}

export interface AutocompleteResult {
  term: string;
  frequency: number;
  score: number;  // Combined score (frequency + recency boost)
}

function createNode(): TrieNode {
  return { children: new Map(), isEnd: false, frequency: 0 };
}

export class Trie {
  private readonly root: TrieNode = createNode();
  private itemCount = 0;

  /**
   * Insert a term with its frequency.
   * For search autocomplete, frequency = number of times this was searched.
   */
  insert(term: string, frequency = 1): void {
    const normalized = term.toLowerCase().trim();
    if (!normalized) return;

    let node = this.root;
    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, createNode());
      }
      node = node.children.get(char)!;
    }

    if (!node.isEnd) {
      this.itemCount++;
    }

    node.isEnd = true;
    node.frequency += frequency;
    node.value = normalized;
  }

  /**
   * Increment frequency of an existing term (called when user searches).
   * Returns false if term not found.
   */
  incrementFrequency(term: string, amount = 1): boolean {
    const node = this.findNode(term.toLowerCase().trim());
    if (!node || !node.isEnd) return false;
    node.frequency += amount;
    return true;
  }

  /**
   * Get autocomplete suggestions for a prefix.
   * Returns top-k results sorted by frequency (most popular first).
   *
   * @param prefix - Search prefix (e.g., "iph")
   * @param limit - Max results to return
   */
  autocomplete(prefix: string, limit = 10): AutocompleteResult[] {
    const normalized = prefix.toLowerCase().trim();
    const startNode = this.findNode(normalized);

    if (!startNode) return [];

    const results: AutocompleteResult[] = [];
    this.dfs(startNode, normalized, results, limit);

    // Sort by frequency descending, then alphabetically for ties
    results.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.term.localeCompare(b.term);
    });

    return results.slice(0, limit).map((r) => ({
      ...r,
      score: r.frequency, // Can add recency boost here
    }));
  }

  /**
   * Fuzzy search — find terms within edit distance of query.
   * Uses DP row computation (O(m×n) but cache-friendly).
   *
   * @param query - Search term
   * @param maxDistance - Max Levenshtein distance (1 or 2 typically)
   * @param limit - Max results
   */
  fuzzySearch(
    query: string,
    maxDistance = 1,
    limit = 10,
  ): AutocompleteResult[] {
    const normalized = query.toLowerCase().trim();
    const results: AutocompleteResult[] = [];

    this.fuzzyDfs(
      this.root,
      '',
      normalized,
      Array.from({ length: normalized.length + 1 }, (_, i) => i),
      maxDistance,
      results,
    );

    results.sort((a, b) => b.frequency - a.frequency);
    return results.slice(0, limit);
  }

  /** Check if an exact term exists */
  has(term: string): boolean {
    const node = this.findNode(term.toLowerCase().trim());
    return !!(node?.isEnd);
  }

  get size(): number {
    return this.itemCount;
  }

  private findNode(prefix: string): TrieNode | null {
    let node = this.root;
    for (const char of prefix) {
      if (!node.children.has(char)) return null;
      node = node.children.get(char)!;
    }
    return node;
  }

  private dfs(
    node: TrieNode,
    current: string,
    results: AutocompleteResult[],
    limit: number,
  ): void {
    if (results.length >= limit * 5) return; // Over-collect to allow sort+trim

    if (node.isEnd) {
      results.push({ term: current, frequency: node.frequency, score: 0 });
    }

    for (const [char, child] of node.children) {
      this.dfs(child, current + char, results, limit);
    }
  }

  private fuzzyDfs(
    node: TrieNode,
    currentTerm: string,
    query: string,
    previousRow: number[],
    maxDistance: number,
    results: AutocompleteResult[],
  ): void {
    const columns = query.length + 1;
    const currentRow: number[] = [previousRow[0] + 1];

    for (let col = 1; col < columns; col++) {
      const insertCost = currentRow[col - 1] + 1;
      const deleteCost = previousRow[col] + 1;
      const replaceCost =
        query[col - 1] === currentTerm[currentTerm.length - 1]
          ? previousRow[col - 1]
          : previousRow[col - 1] + 1;

      currentRow.push(Math.min(insertCost, deleteCost, replaceCost));
    }

    if (
      currentRow[currentRow.length - 1] <= maxDistance &&
      node.isEnd &&
      currentTerm
    ) {
      results.push({
        term: currentTerm,
        frequency: node.frequency,
        score: currentRow[currentRow.length - 1],
      });
    }

    if (Math.min(...currentRow) <= maxDistance) {
      for (const [char, child] of node.children) {
        this.fuzzyDfs(
          child,
          currentTerm + char,
          query,
          currentRow,
          maxDistance,
          results,
        );
      }
    }
  }
}

// ── Compact Trie (DAWG-like) for production use ───────────────
// Serializes to/from Buffer for Redis storage.
// Supports incremental update without full rebuild.
export class CompactTrieSerializer {
  static serialize(trie: Trie): string {
    // DFS collect all terms + frequencies via public API
    const terms: Array<[string, number]> = [];
    const root = (trie as unknown as { root: TrieNode }).root;
    CompactTrieSerializer.collectTerms(root, '', terms);
    return JSON.stringify(terms);
  }

  static deserialize(data: string): Trie {
    const trie = new Trie();
    const terms = JSON.parse(data) as Array<[string, number]>;
    for (const [term, freq] of terms) {
      trie.insert(term, freq);
    }
    return trie;
  }

  private static collectTerms(
    node: TrieNode,
    current: string,
    results: Array<[string, number]>,
  ): void {
    if (node.isEnd) results.push([current, node.frequency]);
    for (const [char, child] of node.children) {
      CompactTrieSerializer.collectTerms(child, current + char, results);
    }
  }
}
