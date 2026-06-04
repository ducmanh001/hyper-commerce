import {
  Controller,
  Get,
  Query,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, RolesGuard, Public, Roles } from '@hypercommerce/common';
import type { SearchService } from './search.service';
import type { SearchAnalyticsService } from './analytics/search-analytics.service';

class IndexProductDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;
}

@ApiTags('search')
@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly analytics: SearchAnalyticsService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Full-text + vector hybrid search' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  @ApiQuery({ name: 'type', required: false, enum: ['PRODUCT', 'USER', 'LIVE', 'ALL'] })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false })
  async search(
    @Query('q') query: string,
    @Query('type') _type = 'ALL',
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: number,
    @Query('maxPrice') maxPrice?: number,
    @Query('limit') limit = 20,
    @Query('cursor') _cursor?: string,
  ) {
    return this.searchService.search({
      query,
      filters: {
        categoryIds: category ? [category] : undefined,
        priceMin: minPrice ? Number(minPrice) : undefined,
        priceMax: maxPrice ? Number(maxPrice) : undefined,
      },
      limit: Number(limit),
    });
  }

  @Get('autocomplete')
  @Public()
  @ApiOperation({ summary: 'Autocomplete suggestions (< 50ms target)' })
  async autocomplete(@Query('q') query: string, @Query('limit') _limit = 10) {
    return this.searchService.autocomplete(query);
  }

  @Get('trending')
  @Public()
  @ApiOperation({ summary: 'Trending searches in last 1 hour' })
  async trending(@Query('limit') limit = 10) {
    return this.searchService.getTrendingSearches(Number(limit));
  }

  @Post('index')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger re-index for a product (admin)' })
  async triggerIndex(@Body() body: { productId: string; type: string }) {
    // Fire-and-forget — actual indexing is async
    void this.searchService.triggerIndex(body.productId);
    return { queued: true };
  }

  @Post('index-product')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SELLER')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Embed and index a product in Qdrant + Elasticsearch (AC2)' })
  async indexProduct(@Body() body: IndexProductDto) {
    await this.searchService.indexProduct(body as unknown as Record<string, unknown>);
    return { indexed: true };
  }

  @Get('analytics/top-queries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Top search queries analytics' })
  async topQueries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.getTopQueries(from, to);
  }
}
