// ============================================================
// HYPERCOMMERCE — Pagination Utility
// Cursor-based pagination (không dùng offset — offset không
// scale ở 50M rows vì DB phải scan từ đầu).
// ============================================================

import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ── DTOs ─────────────────────────────────────────────────────
export class CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Opaque cursor for next page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class OffsetPaginationDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

// ── Response Wrappers ─────────────────────────────────────────
export interface CursorPage<T> {
  data: T[];
  meta: {
    cursor: string | null; // null = last page
    hasMore: boolean;
    count: number;
  };
}

export interface OffsetPage<T> {
  data: T[];
  meta: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ── Helpers ───────────────────────────────────────────────────

// Encode cursor — base64 JSON so it's opaque to client
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

// Decode & validate cursor — never trust client input
export function decodeCursor<T extends Record<string, unknown>>(
  cursor: string,
  requiredFields: (keyof T)[],
): T {
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as T;
  } catch {
    throw new Error(`Invalid cursor: cannot decode`);
  }

  for (const field of requiredFields) {
    if (!(field in payload)) {
      throw new Error(`Invalid cursor: missing field '${String(field)}'`);
    }
  }

  return payload;
}

// Build CursorPage — fetchLimit+1 trick: fetch one extra to detect hasMore
export function buildCursorPage<T>(
  items: T[],
  limit: number,
  cursorExtractor: (item: T) => Record<string, unknown>,
): CursorPage<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const cursor =
    hasMore && data.length > 0 ? encodeCursor(cursorExtractor(data[data.length - 1])) : null;

  return {
    data,
    meta: { cursor, hasMore, count: data.length },
  };
}

// Build OffsetPage
export function buildOffsetPage<T>(
  data: T[],
  offset: number,
  limit: number,
  total: number,
): OffsetPage<T> {
  return {
    data,
    meta: {
      offset,
      limit,
      total,
      hasMore: offset + data.length < total,
    },
  };
}
