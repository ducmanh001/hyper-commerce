import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client as CassandraClient } from 'cassandra-driver';
import { KafkaModule } from '@hypercommerce/kafka';
import { RedisModule } from '@hypercommerce/redis';
import { INJECTION_TOKENS } from '@hypercommerce/common/constants/app.constants';
import { FeedFanoutWorker } from './fanout/feed-fanout.worker';
import { FeedRankerService } from './ranking/feed-ranker.service';
import { ScoringHelper } from './ranking/scoring.helper';
import { FeedRepository } from './repositories/feed.repository';
import { FollowRepository } from './repositories/follow.repository';
import { CelebrityDetectorHelper } from './helpers/celebrity-detector.helper';
import { FeedController } from './feed.controller';

const cassandraProvider = {
  provide: INJECTION_TOKENS.CASSANDRA_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const logger = new Logger('CassandraClient');
    const contactPoints = config.get<string>('CASSANDRA_HOSTS', 'localhost').split(',');
    const datacenter = config.get<string>('CASSANDRA_DATACENTER', 'datacenter1');
    const keyspace = config.get<string>('CASSANDRA_KEYSPACE', 'hypercommerce');
    const client = new CassandraClient({ contactPoints, localDataCenter: datacenter, keyspace });
    client.connect().catch((err: Error) => logger.warn(`Cassandra connect failed: ${err.message}`));
    return client;
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    KafkaModule,
    RedisModule,
  ],
  controllers: [FeedController],
  providers: [cassandraProvider, FeedFanoutWorker, FeedRankerService, ScoringHelper, FeedRepository, FollowRepository, CelebrityDetectorHelper],
})
export class AppModule {}
