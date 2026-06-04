import { Injectable, Logger } from '@nestjs/common';
import type { ElasticsearchService } from '@nestjs/elasticsearch';
import type { RedisClientService } from '@hypercommerce/redis';

export interface IndexableProduct {
  id: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  currency: string;
  sellerId: string;
  sellerName: string;
  images: string[];
  tags: string[];
  rating?: number;
  reviewCount?: number;
  stockAvailable: number;
  attributes?: Record<string, string>;
  embedding?: number[]; // 1536-dim vector from text-embedding-3-small
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ProductIndexer — manages Elasticsearch index for products.
 *
 * Index design:
 * - Standard text fields with custom analyzer (Vietnamese word segmentation)
 * - dense_vector field for semantic search (768 or 1536 dims)
 * - Keyword fields for exact-match filters (category, sellerId)
 * - Numeric fields for range filters (price, rating)
 *
 * Sharding: 5 primary shards (products scale > 100M docs)
 * Replicas: 1 per shard (read scale + HA)
 */
@Injectable()
export class ProductIndexer {
  private readonly logger = new Logger(ProductIndexer.name);
  readonly indexName = 'products';

  constructor(
    private readonly es: ElasticsearchService,
    private readonly redis: RedisClientService,
  ) {}

  readonly mapping = {
    mappings: {
      properties: {
        id: { type: 'keyword' },
        name: { type: 'text', analyzer: 'vietnamese', fields: { keyword: { type: 'keyword' } } },
        description: { type: 'text', analyzer: 'vietnamese' },
        category: { type: 'keyword' },
        price: { type: 'scaled_float', scaling_factor: 100 },
        currency: { type: 'keyword' },
        sellerId: { type: 'keyword' },
        sellerName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
        tags: { type: 'keyword' },
        rating: { type: 'float' },
        reviewCount: { type: 'integer' },
        stockAvailable: { type: 'integer' },
        attributes: { type: 'object', dynamic: true },
        embedding: { type: 'dense_vector', dims: 1536, index: true, similarity: 'cosine' },
        isActive: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
      },
    },
    settings: {
      number_of_shards: 5,
      number_of_replicas: 1,
      analysis: {
        analyzer: {
          vietnamese: {
            type: 'custom',
            tokenizer: 'standard',
            filter: ['lowercase', 'asciifolding', 'vi_stop'],
          },
        },
        filter: {
          vi_stop: {
            type: 'stop',
            stopwords: ['và', 'của', 'là', 'có', 'trong', 'với', 'được', 'cho', 'này', 'đó'],
          },
        },
      },
    },
  };

  async ensureIndex(): Promise<void> {
    const exists = await this.es.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.es.indices.create({
        index: this.indexName,
        ...this.mapping,
      } as unknown as Parameters<typeof this.es.indices.create>[0]);
      this.logger.log(`Created ES index: ${this.indexName}`);
    }
  }

  async index(product: IndexableProduct): Promise<void> {
    await this.es.index({
      index: this.indexName,
      id: product.id,
      document: product,
      refresh: false, // Async refresh — don't block on search visibility
    });

    // Invalidate autocomplete cache for terms in product name
    await this.redis.del(`autocomplete:${product.name.substring(0, 3).toLowerCase()}`);
  }

  async bulkIndex(products: IndexableProduct[]): Promise<{ indexed: number; failed: number }> {
    if (products.length === 0) return { indexed: 0, failed: 0 };

    const operations = products.flatMap((doc) => [
      { index: { _index: this.indexName, _id: doc.id } },
      doc,
    ]);

    const result = await this.es.bulk({ body: operations, refresh: false });
    const failed = result.items.filter((item) => item.index?.error).length;
    const indexed = products.length - failed;

    this.logger.log(`Bulk indexed: ${indexed} products, ${failed} failed`);
    return { indexed, failed };
  }

  async delete(productId: string): Promise<void> {
    await this.es.delete({ index: this.indexName, id: productId, refresh: false });
  }

  async updatePartial(productId: string, fields: Partial<IndexableProduct>): Promise<void> {
    await this.es.update({
      index: this.indexName,
      id: productId,
      doc: fields,
      doc_as_upsert: false,
    });
  }
}
