import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@hypercommerce/database';
import { KafkaModule } from '@hypercommerce/kafka';
import { NotificationModule } from './notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot({ entities: [__dirname + '/**/*.entity{.ts,.js}'], synchronize: false }),
    KafkaModule,
    NotificationModule,
  ],
})
export class AppModule {}
