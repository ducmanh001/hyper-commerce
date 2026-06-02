// ============================================================
// libs/database — TypeORM Database Module
// Shared database configuration for all services.
// Uses connection pooling + read replicas for scale.
// ============================================================
import { Module, DynamicModule } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export interface DatabaseOptions {
  entities: string[];
  migrations?: string[];
  synchronize?: boolean;
}

@Module({})
export class DatabaseModule {
  /**
   * forRoot() — connects with environment-driven config.
   * Each service calls this in its AppModule.
   *
   * Connection pool: min=2, max=10 (per pod).
   * With 50 pods: 500 max connections → use PgBouncer in transaction mode.
   */
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
            type: 'postgres',
            host: config.get<string>('DB_HOST', 'localhost'),
            port: config.get<number>('DB_PORT', 5432),
            username: config.get<string>('DB_USER', 'postgres'),
            password: config.get<string>('DB_PASSWORD', 'postgres'),
            database: config.get<string>('DB_NAME', 'hypercommerce'),
            entities: options.entities,
            migrations: options.migrations ?? [],
            synchronize: options.synchronize ?? false,  // NEVER true in production
            logging: config.get<string>('NODE_ENV') === 'development' ? ['query', 'error'] : ['error'],
            // Connection pool
            extra: {
              max: config.get<number>('DB_POOL_MAX', 10),
              min: config.get<number>('DB_POOL_MIN', 2),
              idleTimeoutMillis: 30_000,
              connectionTimeoutMillis: 5_000,
            },
            // SSL in production
            ssl: config.get<string>('NODE_ENV') === 'production'
              ? { rejectUnauthorized: true }
              : false,
            // Retry on startup (container init race condition)
            retryAttempts: 10,
            retryDelay: 3_000,
          }),
          inject: [ConfigService],
        }),
      ],
      exports: [TypeOrmModule],
    };
  }
}
