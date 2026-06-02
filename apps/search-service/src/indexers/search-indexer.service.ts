import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KafkaConsumerService } from '@hypercommerce/kafka';
import { ProductIndexer } from './product.indexer';
import { UserIndexer, LiveStreamIndexer } from './user.indexer';
import { APP_CONSTANTS } from '@hypercommerce/common';

/**
 * SearchIndexerService — Kafka consumer that listens to domain events
 * and keeps Elasticsearch indices up to date.
 *
 * Pattern: CDC (Change Data Capture) via Kafka
 * - Products created/updated/deleted → index in ES
 * - Users registered → index in ES
 * - Live streams started/ended → index in ES
 *
 * Why Kafka instead of direct DB → ES sync?
 * - Decoupled: ES outage doesn't affect product writes
 * - Replay: re-index from beginning of topic if ES goes down
 * - Consistent: same event stream used by multiple consumers
 */
@Injectable()
export class SearchIndexerService implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    private readonly kafka: KafkaConsumerService,
    private readonly productIndexer: ProductIndexer,
    private readonly userIndexer: UserIndexer,
    private readonly liveStreamIndexer: LiveStreamIndexer,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.productIndexer.ensureIndex().catch((err: Error) => this.logger.warn(`ES index init failed: ${err.message}`));

    this.kafka.registerConsumer({
      groupId: 'search-indexer',
      topics: [
        'product.created', 'product.updated', 'product.deleted',
        'user.registered', 'user.updated',
        'live.started', 'live.ended',
      ],
      handlers: [
        { topic: 'product.created', handle: this.onProductCreated.bind(this) as (m: Record<string, unknown>) => Promise<void> },
        { topic: 'product.updated', handle: this.onProductUpdated.bind(this) as (m: Record<string, unknown>) => Promise<void> },
        { topic: 'product.deleted', handle: this.onProductDeleted.bind(this) as (m: Record<string, unknown>) => Promise<void> },
        { topic: 'user.registered', handle: this.onUserRegistered.bind(this) as (m: Record<string, unknown>) => Promise<void> },
        { topic: 'live.started',    handle: this.onLiveStarted.bind(this) as (m: Record<string, unknown>) => Promise<void> },
        { topic: 'live.ended',      handle: this.onLiveEnded.bind(this) as (m: Record<string, unknown>) => Promise<void> },
      ],
    }).catch((err: Error) => this.logger.warn(`Kafka consumer registration failed: ${err.message}`));
  }

  private async onProductCreated(event: Record<string, unknown>): Promise<void> {
    this.logger.log(`Indexing new product: ${event['productId']}`);
    await this.productIndexer.index(event as unknown as Parameters<typeof this.productIndexer.index>[0]);
  }

  private async onProductUpdated(event: Record<string, unknown>): Promise<void> {
    await this.productIndexer.updatePartial(
      event['productId'] as string,
      event['changes'] as Parameters<typeof this.productIndexer.updatePartial>[1],
    );
  }

  private async onProductDeleted(event: Record<string, unknown>): Promise<void> {
    await this.productIndexer.delete(event['productId'] as string);
  }

  private async onUserRegistered(event: Record<string, unknown>): Promise<void> {
    await this.userIndexer.index(event as Parameters<typeof this.userIndexer.index>[0]);
  }

  private async onLiveStarted(event: Record<string, unknown>): Promise<void> {
    await this.liveStreamIndexer.index(event as Parameters<typeof this.liveStreamIndexer.index>[0]);
  }

  private async onLiveEnded(event: Record<string, unknown>): Promise<void> {
    await this.liveStreamIndexer.markEnded(event['streamId'] as string);
  }
}
