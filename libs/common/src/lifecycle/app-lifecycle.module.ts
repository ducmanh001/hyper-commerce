/**
 * AppLifecycleModule — Global infrastructure lifecycle manager
 *
 * WHAT IT MANAGES:
 *   1. MemoryLifecycleService — monitors heap, detects leaks, sets pressure flag
 *   2. BufferPoolLifecycleService — pre-allocates buffer pools, releases on shutdown
 *
 * HOW TO USE:
 *   Import into your AppModule as a global module.
 *   Other modules can inject MemoryLifecycleService or BufferPoolLifecycleService.
 *
 *   @Module({
 *     imports: [AppLifecycleModule],  // <-- add this
 *   })
 *   export class AppModule {}
 *
 * WHY GLOBAL:
 *   Hardware resources (buffers, memory monitor) are process-wide singletons.
 *   Making it @Global() means any service in any module can inject
 *   BufferPoolLifecycleService without re-importing AppLifecycleModule.
 *
 * STARTUP ORDER:
 *   NestJS calls onApplicationBootstrap() after all providers are initialized.
 *   This means DB connections, Redis, Kafka are all ready before we start
 *   monitoring. Correct order: init → monitor (not monitor → init).
 */
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MemoryLifecycleService } from './memory-lifecycle.service';
import { BufferPoolLifecycleService } from './buffer-pool-lifecycle.service';
import hardwareConfig from '../config/hardware.config';

@Global()
@Module({
  imports: [ConfigModule.forFeature(hardwareConfig)],
  providers: [MemoryLifecycleService, BufferPoolLifecycleService],
  exports: [MemoryLifecycleService, BufferPoolLifecycleService],
})
export class AppLifecycleModule {}
