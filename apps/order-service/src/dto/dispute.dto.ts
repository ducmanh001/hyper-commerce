import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  IsUrl,
  ArrayMaxSize,
} from 'class-validator';
import type { DisputeReason } from '../entities/dispute.entity';

export class CreateDisputeDto {
  @ApiProperty({
    example: 'ITEM_NOT_RECEIVED',
    enum: [
      'ITEM_NOT_RECEIVED',
      'ITEM_NOT_AS_DESCRIBED',
      'DEFECTIVE_ITEM',
      'WRONG_ITEM_SENT',
      'COUNTERFEIT_ITEM',
      'DAMAGED_IN_TRANSIT',
      'MISSING_PARTS',
      'SELLER_CANCELLED',
    ],
  })
  @IsEnum([
    'ITEM_NOT_RECEIVED',
    'ITEM_NOT_AS_DESCRIBED',
    'DEFECTIVE_ITEM',
    'WRONG_ITEM_SENT',
    'COUNTERFEIT_ITEM',
    'DAMAGED_IN_TRANSIT',
    'MISSING_PARTS',
    'SELLER_CANCELLED',
  ])
  reason!: DisputeReason;

  @ApiProperty({ example: 'The package arrived but the box was empty. I have photos as evidence.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'S3 pre-signed URLs of evidence (photos, screenshots)',
    maxItems: 10,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  evidenceUrls?: string[];

  @ApiPropertyOptional({
    example: 150000,
    description: 'Amount you are requesting as refund (VND). Defaults to full order amount.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  requestedRefundAmount?: number;
}

export class ResolveDisputeDto {
  @ApiProperty({
    example: 'FULL_REFUND',
    enum: ['FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'NO_ACTION', 'WITHDRAWAL'],
  })
  @IsEnum(['FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'NO_ACTION', 'WITHDRAWAL'])
  resolution!: string;

  @ApiPropertyOptional({ example: 75000, description: 'For PARTIAL_REFUND only' })
  @IsOptional()
  @IsInt()
  @Min(0)
  refundAmount?: number;

  @ApiPropertyOptional({
    example: 'Customer provided valid evidence of empty package. Full refund approved.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SellerDisputeResponseDto {
  @ApiProperty({ example: 'We shipped the correct item. Tracking shows delivered 2024-01-15.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  response!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  evidenceUrls?: string[];
}
