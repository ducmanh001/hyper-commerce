import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { BiddingModel, CampaignType } from '../entities/campaign.entity';
import { Type } from 'class-transformer';

export class CreateCampaignDto {
  @ApiProperty({ description: 'Display name of the campaign' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: CampaignType, default: CampaignType.SPONSORED_PRODUCT })
  @IsEnum(CampaignType)
  type: CampaignType;

  @ApiProperty({ enum: BiddingModel, default: BiddingModel.CPC })
  @IsEnum(BiddingModel)
  biddingModel: BiddingModel;

  @ApiProperty({ description: 'Total lifetime budget in VND', example: 5_000_000 })
  @IsInt()
  @Min(100_000) // Minimum ₫100K budget
  totalBudget: number;

  @ApiPropertyOptional({ description: 'Daily budget cap in VND' })
  @IsOptional()
  @IsInt()
  @Min(50_000)
  dailyBudget?: number;

  @ApiProperty({ description: 'Max CPC/CPM bid in VND', example: 2000 })
  @IsInt()
  @Min(500) // ₫500 min bid
  @Max(500_000)
  maxBidVnd: number;

  @ApiPropertyOptional({ type: [String], description: 'Keywords to target' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetKeywords?: string[];

  @ApiProperty({ type: [String], description: 'Product IDs to promote' })
  @IsArray()
  @IsUUID('4', { each: true })
  productIds: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetCategories?: string[];
}

export class UpdateCampaignDto extends PartialType(
  PickType(CreateCampaignDto, [
    'name',
    'totalBudget',
    'dailyBudget',
    'maxBidVnd',
    'targetKeywords',
    'targetCategories',
  ] as const),
) {}

export class AuctionRequestDto {
  @ApiProperty({ type: [String], description: 'Search keywords for context matching' })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Max ad slots to return', default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  limit?: number;
}

export class RecordClickDto {
  @ApiProperty({ description: 'Impression ID returned from auction' })
  @IsUUID('4')
  impressionId: string;

  @ApiPropertyOptional({ description: 'Authenticated user ID (optional for guests)' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
