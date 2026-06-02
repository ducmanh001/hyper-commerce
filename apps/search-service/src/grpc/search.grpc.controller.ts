// apps/search-service/src/grpc/search.grpc.controller.ts
// gRPC controller for internal service-to-service search queries.
// Example: AI service calling Search to find similar products.

import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from '@hypercommerce/grpc';
import { SearchService } from '../search.service';
import { AutocompleteService } from '../suggest/autocomplete.service';

interface GrpcSearchRequest {
  query: string;
  userId?: string;
  categories?: string[];
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  useVectorSearch?: boolean;
  useRrf?: boolean;
}

interface GrpcAutocompleteRequest {
  prefix: string;
  limit?: number;
  userId?: string;
}

interface GrpcIndexProductRequest {
  productId: string;
  title: string;
  description: string;
  category: string;
  price: number;
  tags: string[];
  brand: string;
  isActive: boolean;
}

@Controller()
@UseFilters(new GrpcExceptionFilter())
export class SearchGrpcController {
  constructor(
    private readonly searchService: SearchService,
    private readonly autocompleteService: AutocompleteService,
  ) {}

  @GrpcMethod('SearchService', 'Search')
  async search(data: GrpcSearchRequest) {
    const result = await this.searchService.search({
      query: data.query,
      userId: data.userId,
      filters: {
        categoryIds: data.categories,
        priceMin: data.minPrice,
        priceMax: data.maxPrice,
      },
      page: (data.page ?? 1) - 1,
      limit: data.pageSize ?? 20,
      sort: data.sortBy as 'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'NEWEST' | 'RATING' | undefined,
    });

    return {
      hits: result.hits,
      total: result.total,
    };
  }

  @GrpcMethod('SearchService', 'Autocomplete')
  async autocomplete(data: GrpcAutocompleteRequest) {
    const suggestions = await this.autocompleteService.suggest(
      data.prefix,
      data.limit ?? 10,
    );
    return { suggestions };
  }

  @GrpcMethod('SearchService', 'Suggest')
  async suggest(data: { productId: string; userId?: string; limit?: number }) {
    // Find similar products to productId using vector search
    const result = await this.searchService.findSimilar(
      data.productId,
      data.limit ?? 10,
    );
    return { products: result };
  }

  @GrpcMethod('SearchService', 'IndexProduct')
  async indexProduct(data: GrpcIndexProductRequest) {
    await this.searchService.indexProduct({
      id: data.productId,
      title: data.title,
      description: data.description,
      category: data.category,
      price: data.price,
      tags: data.tags,
      brand: data.brand,
      isActive: data.isActive,
    });

    return { success: true, indexId: data.productId };
  }
}
