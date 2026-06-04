import { IsInt, IsPositive, IsOptional, IsString, IsUUID, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopupDto {
  @ApiProperty({ description: 'Amount in VND dong', example: 100000 })
  @IsInt()
  @IsPositive()
  @Max(50_000_000) // 50M VND per topup
  amount!: number;

  @ApiPropertyOptional({ description: 'External payment reference ID' })
  @IsOptional()
  @IsUUID()
  refId?: string;
}

export class TransactionQueryDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  limit?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  cursor?: number;

  @ApiPropertyOptional({ description: 'Filter by type', example: 'CASHBACK' })
  @IsOptional()
  @IsString()
  type?: string;
}
