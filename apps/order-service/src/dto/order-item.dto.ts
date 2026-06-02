import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsPositive,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

/**
 * OrderItemDto — one line-item inside a CreateOrderDto.
 * Price is always verified server-side against product catalog.
 * Client-provided price is only used as intent, not trusted.
 */
export class OrderItemDto {
  @ApiProperty({ example: 'prod_abc123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  productId!: string;

  @ApiPropertyOptional({ example: 'variant_size_L_red' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  variantId?: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 9999 })
  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(9999)
  quantity!: number;

  /**
   * Client price — for UX feedback only.
   * Server re-validates against catalog before accepting.
   * Mismatch > 1% → PriceMismatchException.
   */
  @ApiProperty({ example: 150000, description: 'Unit price in smallest currency unit (VND)' })
  @IsInt()
  @Min(0)
  clientUnitPrice!: number;

  /** Product snapshot at order time — preserved even if catalog changes */
  @ApiPropertyOptional()
  @IsOptional()
  snapshot?: {
    name: string;
    imageUrl: string;
    attributes?: Record<string, string>;
  };
}
