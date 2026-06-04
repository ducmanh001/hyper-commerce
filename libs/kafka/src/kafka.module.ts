/**
 * KafkaModule — Global NestJS module wrapping Kafka producer/consumer.
 * Import once in AppModule; KafkaProducerService and KafkaConsumerService
 * become available project-wide via dependency injection.
 *
 * WHY a module wrapper:
 *   NestJS DI needs providers declared in a Module.
 *   @Global() means downstream modules don't need to import KafkaModule themselves.
 */
import { Global, Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka.producer';
import { KafkaConsumerService } from './kafka.consumer';

@Global()
@Module({
  providers: [KafkaProducerService, KafkaConsumerService],
  exports: [KafkaProducerService, KafkaConsumerService],
})
export class KafkaModule {}
