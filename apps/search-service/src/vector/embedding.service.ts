import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import type { RedisClientService } from '@hypercommerce/redis';
import type { QdrantInitService } from './qdrant-init.service';

export interface ProductData {
  id: string;
  name: string;
  description?: string;
  category?: string;
}

interface QdrantSearchResponse {
  result: Array<{ id: string | number; score: number }>;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly EMBED_TTL = 86400; // 24 hours
  private readonly DIMENSIONS = 768;
  private readonly openai: OpenAI;

  constructor(
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
    private readonly qdrant: QdrantInitService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      timeout: 10_000,
    });
  }

  hashContent(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  async embedQuery(text: string): Promise<number[] | null> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: text,
        dimensions: this.DIMENSIONS,
      });
      return response.data[0]?.embedding ?? null;
    } catch (error) {
      this.logger.error(`Query embedding failed: ${(error as Error).message}`);
      return null;
    }
  }

  async embedProduct(product: ProductData): Promise<void> {
    const input = `${product.name} ${product.description ?? ''} ${product.category ?? ''}`.trim();
    const hash = this.hashContent(input);
    const cacheKey = `embed:product:${product.id}`;

    const cachedHash = await this.redis.get(cacheKey);
    if (cachedHash === hash) {
      this.logger.debug(`Content unchanged for product ${product.id} — skipping re-embed`);
      return;
    }

    let vector: number[];
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-large',
        input,
        dimensions: this.DIMENSIONS,
      });
      const embedding = response.data[0]?.embedding;
      if (!embedding?.length) {
        this.logger.warn(`Empty embedding returned for product ${product.id}`);
        return;
      }
      vector = embedding;
    } catch (error) {
      this.logger.error(
        `OpenAI embedding failed for product ${product.id}: ${(error as Error).message}`,
      );
      return;
    }

    try {
      await this.qdrant.getClient().put<QdrantSearchResponse>('/collections/products/points', {
        points: [{ id: product.id, vector, payload: { productId: product.id } }],
      });
    } catch (error) {
      this.logger.error(
        `Qdrant upsert failed for product ${product.id}: ${(error as Error).message}`,
      );
      return;
    }

    await this.redis.set(cacheKey, hash, this.EMBED_TTL);
    this.logger.log(`Product embedded and upserted to Qdrant: ${product.id}`);
  }
}
