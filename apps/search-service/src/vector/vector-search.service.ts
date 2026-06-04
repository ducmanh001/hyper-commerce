import { Injectable, Logger } from '@nestjs/common';
import type { QdrantInitService } from './qdrant-init.service';

interface QdrantSearchResponse {
  result: Array<{ id: string | number; score: number }>;
}

/**
 * VectorSearchService — kNN approximate nearest neighbour search via Qdrant.
 * Used for semantic product search (embedding similarity).
 */
@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(private readonly qdrant: QdrantInitService) {}

  /**
   * Perform kNN search against Qdrant `products` collection using a query vector.
   * Returns ranked product IDs with similarity scores.
   * Falls back to empty array on Qdrant outage (graceful degradation).
   */
  async knnSearch(vector: number[], topK = 20): Promise<Array<{ id: string; score: number }>> {
    if (!vector.length) return [];

    try {
      const response = await this.qdrant
        .getClient()
        .post<QdrantSearchResponse>('/collections/products/points/search', {
          vector,
          limit: topK,
          with_payload: false,
          with_vector: false,
        });

      return (response.data.result ?? []).map((hit) => ({
        id: String(hit.id),
        score: hit.score,
      }));
    } catch (error) {
      this.logger.warn(
        `Qdrant kNN search failed — falling back to BM25 only: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /** Backwards-compatible wrapper used by SearchService. */
  async search(
    queryVector: number[],
    opts: { index?: string; topK?: number },
  ): Promise<Array<{ id: string; score: number }>> {
    return this.knnSearch(queryVector, opts.topK);
  }
}
