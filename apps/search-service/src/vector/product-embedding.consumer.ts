import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import type { EmbeddingService } from './embedding.service';

@Injectable()
export class ProductEmbeddingConsumer implements OnModuleInit {
  private readonly logger = new Logger(ProductEmbeddingConsumer.name);

  constructor(
    private readonly kafka: KafkaConsumerService,
    private readonly embedding: EmbeddingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.kafka
      .registerConsumer({
        groupId: 'search-embedder',
        topics: ['product.created', 'product.updated'],
        handlers: [
          {
            topic: 'product.created',
            handle: this.onProductCreated.bind(this) as (
              m: Record<string, unknown>,
              meta: MessageMetadata,
            ) => Promise<void>,
          },
          {
            topic: 'product.updated',
            handle: this.onProductUpdated.bind(this) as (
              m: Record<string, unknown>,
              meta: MessageMetadata,
            ) => Promise<void>,
          },
        ],
      })
      .catch((err: Error) =>
        this.logger.warn(`Kafka consumer registration failed: ${err.message}`),
      );
  }

  private async onProductCreated(event: Record<string, unknown>): Promise<void> {
    this.logger.log(`Embedding product on created: ${event['productId']}`);
    await this.embedding.embedProduct({
      id: event['productId'] as string,
      name: event['name'] as string,
      description: event['description'] as string | undefined,
      category: event['category'] as string | undefined,
    });
  }

  private async onProductUpdated(event: Record<string, unknown>): Promise<void> {
    const changes = event['changes'] as Record<string, unknown> | undefined;
    this.logger.log(`Embedding product on updated: ${event['productId']}`);
    await this.embedding.embedProduct({
      id: event['productId'] as string,
      name: ((changes?.['name'] ?? event['name']) as string) || '',
      description: (changes?.['description'] ?? event['description']) as string | undefined,
      category: (changes?.['category'] ?? event['category']) as string | undefined,
    });
  }
}
