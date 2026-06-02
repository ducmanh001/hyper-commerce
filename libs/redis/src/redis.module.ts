/**
 * RedisModule — Global NestJS module wrapping RedisClientService.
 * Import once in AppModule; RedisClientService available project-wide.
 */
import { Global, Module } from '@nestjs/common';
import { RedisClientService } from './redis.client';

@Global()
@Module({
  providers: [RedisClientService],
  exports:   [RedisClientService],
})
export class RedisModule {}
