import { Controller, Post, Body } from '@nestjs/common';
import type {
  NotificationService,
  NotificationType,
  NotificationChannel,
} from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('send')
  async send(
    @Body()
    body: {
      userId: string;
      type: NotificationType;
      title: string;
      body: string;
      channels?: NotificationChannel[];
      data?: Record<string, string>;
      priority?: 'HIGH' | 'NORMAL' | 'LOW';
    },
  ) {
    return this.notificationService.dispatch({
      userId: body.userId,
      type: body.type,
      channels: body.channels ?? ['IN_APP'],
      title: body.title,
      body: body.body,
      data: body.data,
      priority: body.priority ?? 'NORMAL',
    });
  }
}
