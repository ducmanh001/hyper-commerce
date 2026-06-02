import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@hypercommerce/database';
import { OrderModule } from './order.module';

@Module({
  imports: [
    // Config — reads .env
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),

    // Scheduler — for saga timeout cleanup cron jobs
    ScheduleModule.forRoot(),

    // Database — PostgreSQL (Citus for horizontal sharding)
    DatabaseModule.forRoot({
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
    }),

    // Feature module
    OrderModule,
  ],
})
export class AppModule {}
