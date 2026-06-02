import { Injectable, Logger } from '@nestjs/common';
import { KafkaConsumerService, MessageMetadata } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common';
import { NotificationService } from '../notification.service';

@Injectable()
export class NotificationEventHandler {
  private readonly logger = new Logger(NotificationEventHandler.name);

  constructor(
    private readonly kafka: KafkaConsumerService,
    private readonly notificationService: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const topic = APP_CONSTANTS.KAFKA_TOPICS.NOTIFICATION_DISPATCH;
    this.kafka.registerConsumer({
      groupId: 'notification-service',
      topics: [topic],
      handlers: [
        {
          topic,
          handle: async (message: Record<string, unknown>, _meta: MessageMetadata) => {
            try {
              const payload = message as unknown as Parameters<NotificationService['dispatch']>[0];
              await this.notificationService.dispatch(payload);
            } catch (err) {
              this.logger.error('Failed to handle notification.dispatch event', err);
            }
          },
        },
      ],
}).catch((err: Error) => this.logger.warn(`Kafka consumer init failed (will not retry): ${err.message}`));
  }
}
