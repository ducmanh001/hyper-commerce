import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { KafkaModule } from '@hypercommerce/kafka';
import { RedisModule } from '@hypercommerce/redis';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchIndexerService } from './indexers/search-indexer.service';
import { ProductIndexer } from './indexers/product.indexer';
import { UserIndexer, LiveStreamIndexer } from './indexers/user.indexer';
import { QueryUnderstandingService } from './query-understanding/query-understanding.service';
import { SearchRankingService } from './ranking/search-ranking.service';
import { ReciprocalRankFusionHelper } from './ranking/reciprocal-rank-fusion.helper';
import { SearchAnalyticsService } from './analytics/search-analytics.service';
import { VectorSearchService } from './vector/vector-search.service';
import { QdrantInitService } from './vector/qdrant-init.service';
import { EmbeddingService } from './vector/embedding.service';
import { ProductEmbeddingConsumer } from './vector/product-embedding.consumer';

@Module({
  imports: [
    ConfigModule,
    KafkaModule,
    RedisModule,
    ElasticsearchModule.registerAsync({
      useFactory: () => ({
        node: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
        auth: process.env.ELASTICSEARCH_API_KEY
          ? { apiKey: process.env.ELASTICSEARCH_API_KEY }
          : undefined,
        requestTimeout: 5000,
        maxRetries: 3,
      }),
    }),
  ],
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchIndexerService,
    ProductIndexer,
    UserIndexer,
    LiveStreamIndexer,
    QueryUnderstandingService,
    SearchRankingService,
    ReciprocalRankFusionHelper,
    SearchAnalyticsService,
    QdrantInitService,
    EmbeddingService,
    VectorSearchService,
    ProductEmbeddingConsumer,
  ],
})
export class SearchModule {}
