// libs/queue/src/queue.module.ts
// NestJS module that provides BullMQ Queue instances via DI.
// Each queue is registered as a named provider.

import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  createQueue,
  createCriticalQueue,
  createNonCriticalQueue,
  createBestEffortQueue,
  setQueueRedisConnection,
} from './queue.factory';
import { QUEUE_NAMES, QueueName } from './constants/queue.constants';

export const QUEUE_TOKEN = (name: string) => `QUEUE:${name}`;

export interface QueueRegistration {
  name: QueueName;
  type?: 'critical' | 'non-critical' | 'best-effort' | 'default';
}

@Module({})
export class QueueModule {
  static register(queues: QueueRegistration[]): DynamicModule {
    const providers: Provider[] = [
      {
        provide: 'QUEUE_INIT',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          setQueueRedisConnection({
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
            password: config.get<string>('REDIS_PASSWORD'),
            db: config.get<number>('REDIS_QUEUE_DB', 1), // separate DB for queues
            maxRetriesPerRequest: null, // required by BullMQ
            enableReadyCheck: false,
          });
          return true;
        },
      },
      ...queues.map((q): Provider => ({
        provide: QUEUE_TOKEN(q.name),
        inject: ['QUEUE_INIT'],
        useFactory: (_init: boolean) => {
          switch (q.type) {
            case 'critical': return createCriticalQueue(q.name);
            case 'non-critical': return createNonCriticalQueue(q.name);
            case 'best-effort': return createBestEffortQueue(q.name);
            default: return createQueue(q.name);
          }
        },
      })),
    ];

    return {
      module: QueueModule,
      providers,
      exports: [
        ...queues.map((q) => QUEUE_TOKEN(q.name)),
      ],
    };
  }

  /**
   * Register ALL queues at once (for admin/monitoring service).
   */
  static registerAll(): DynamicModule {
    const allQueues: QueueRegistration[] = Object.values(QUEUE_NAMES).map(
      (name) => ({ name: name as QueueName }),
    );
    return QueueModule.register(allQueues);
  }
}

// Helper decorator to inject a specific queue
export function InjectQueue(name: QueueName) {
  return (target: object, propertyKey: string | symbol, parameterIndex: number) => {
    const token = QUEUE_TOKEN(name);
    Reflect.defineMetadata(
      `queue:${String(propertyKey)}:${parameterIndex}`,
      token,
      target,
    );
    // Use NestJS Inject
    const Inject = require('@nestjs/common').Inject;
    Inject(token)(target, propertyKey, parameterIndex);
  };
}
