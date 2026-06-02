import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Notification } from './entities/notification.entity';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationRepository } from './repositories/notification.repository';
import { ChannelFactory } from './channels/channel.factory';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PushChannel } from './channels/push.channel';
import { InAppChannel } from './channels/in-app.channel';
import { TemplateService } from './templates/template.service';
import { NotificationEventHandler } from './handlers/notification-event.handler';
import { KafkaConsumerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), ConfigModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationRepository,
    ChannelFactory,
    EmailChannel,
    SmsChannel,
    PushChannel,
    InAppChannel,
    TemplateService,
    NotificationEventHandler,
    KafkaConsumerService,
    RedisClientService,
  ],
})
export class NotificationModule {}
