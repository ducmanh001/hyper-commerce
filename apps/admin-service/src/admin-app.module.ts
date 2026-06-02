import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'hypercommerce',
        username: process.env.POSTGRES_USER ?? 'hc_user',
        password: process.env.POSTGRES_PASSWORD,
        // Admin service uses a read-only replica to avoid impacting writes
        synchronize: false,
        logging: ['warn', 'error'],
        extra: {
          max: 10,           // smaller pool — admin queries are heavier but less frequent
          idleTimeoutMillis: 30000,
          application_name: 'admin-service',
        },
      }),
    }),
    AdminModule,
  ],
})
export class AdminAppModule {}
