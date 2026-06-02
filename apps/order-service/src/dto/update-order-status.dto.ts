import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';
import { OrderTransition } from '../saga/order-state-machine';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: ['RESERVE_STOCK', 'INITIATE_PAYMENT', 'CONFIRM', 'SHIP', 'DELIVER', 'CANCEL', 'REFUND'],
    description: 'State machine transition name',
  })
  @IsString()
  @IsIn(['RESERVE_STOCK', 'INITIATE_PAYMENT', 'CONFIRM', 'SHIP', 'DELIVER', 'CANCEL', 'REFUND'])
  transition!: OrderTransition;
}
