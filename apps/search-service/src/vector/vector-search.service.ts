import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';

/**
 * VectorSearchService — kNN approximate nearest neighbour search via Elasticsearch dense_vector.
 * Used for semantic product search (embedding similarity).
 */
@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(private readonly es: ElasticsearchService) {}

  /**
   * Perform kNN search against the products index using a query vector.
   * Returns ranked product IDs with similarity scores.
   */
  async search(
    queryVector: number[],
    opts: {
      index: string;
      topK?: number;
      numCandidates?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<Array<{ id: string; score: number }>> {
    const { index, topK = 20, numCandidates = 100, filter } = opts;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.es.search<any>({
        index,
        knn: {
          field: 'embedding',
          query_vector: queryVector,
          k: topK,
          num_candidates: numCandidates,
          filter,
        },
        _source: false,
      } as Parameters<typeof this.es.search>[0]);

      return (response.hits?.hits ?? []).map((hit) => ({
        id: hit._id as string,
        score: hit._score ?? 0,
      }));
    } catch (error) {
      this.logger.warn(`Vector search error: ${(error as Error).message}`);
      return [];
    }
  }
}
