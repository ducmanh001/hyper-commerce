import { Module } from '@nestjs/common';
import { WorkerThreadService } from './worker-thread.service';

@Module({
  providers: [WorkerThreadService],
  exports:   [WorkerThreadService],
})
export class WorkerThreadModule {}
