import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderItemDto } from './order-item.dto';
import { ShippingAddressDto } from './shipping-address.dto';

/**
 * CreateOrderDto — top-level create payload.
 *
 * Idempotency key MUST be provided by client (frontend generates UUID).
 * This allows safe retry on network failure without double-charging.
 */
export class CreateOrderDto {
  @ApiProperty({
    description: 'Client-generated UUID for idempotency. Safe to retry with same key.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  @ApiProperty({ type: [OrderItemDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiProperty({ type: ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  @ApiPropertyOptional({ example: 'VND', enum: ['VND', 'USD', 'SGD'] })
  @IsOptional()
  @IsIn(['VND', 'USD', 'SGD', 'THB', 'IDR'])
  currency?: string;

  @ApiPropertyOptional({ example: 'seller_xyz' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sellerId?: string;

  @ApiPropertyOptional({ example: 'STANDARD', enum: ['STANDARD', 'EXPRESS', 'SAME_DAY'] })
  @IsOptional()
  @IsIn(['STANDARD', 'EXPRESS', 'SAME_DAY'])
  shippingMethod?: string;

  @ApiPropertyOptional({ example: 'DISCOUNT10', description: 'Voucher/coupon code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  voucherCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
