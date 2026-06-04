/**
 * AppModule — Root module for User Service
 *
 * INFRASTRUCTURE MODULES (global, loaded once):
 *   ConfigModule     — typed env config, available everywhere via @Inject(config.KEY)
 *   DatabaseModule   — TypeORM connection pool with entity discovery
 *   AppLifecycleModule — MemoryMonitor + BufferPool lifecycle (global singleton)
 *
 * FEATURE MODULES:
 *   UserModule       — Clean Architecture user domain (domain/application/infra/presentation)
 *
 * LIFECYCLE:
 *   AppLifecycleModule is @Global() — its providers (MemoryLifecycleService,
 *   BufferPoolLifecycleService) are available in any module without re-importing.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from '@hypercommerce/database';
import { AppLifecycleModule } from '@hypercommerce/common/lifecycle/app-lifecycle.module';
import hardwareConfig from '@hypercommerce/common/config/hardware.config';
import { UserModule } from './user.module';

@Module({
  imports: [
    // Config must be first so subsequent modules can read env vars
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [hardwareConfig], // Load hardware config globally
    }),

    // Database connection pool
    DatabaseModule.forRoot({
      entities: [__dirname + '/**/*.document{.ts,.js}', __dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
    }),

    // Hardware lifecycle (memory monitoring + buffer pools)
    // @Global() → no need to import in child modules
    AppLifecycleModule,

    // Event emitter for domain events
    EventEmitterModule.forRoot(),

    // Feature modules
    UserModule,
  ],
})
export class AppModule {}
