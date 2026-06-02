// Product listing page — SSR + streaming
// WHY SSR: Google crawls product listings → must be pre-rendered
// Supports search, filter by category/price, sorting

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { searchProducts } from '@/lib/api-client';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ProductCard } from '@/components/product/ProductCard';
import { ProductFilters } from '@/components/product/ProductFilters';
import { ProductSort } from '@/components/product/ProductSort';
import { Pagination } from '@/components/ui/Pagination';
import type { Product, SearchResult } from '@/types';

interface PageProps {
  searchParams: {
    q?: string;
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    page?: string;
    sort?: string;
  };
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const q = searchParams.q;
  return {
    title: q ? `Tìm kiếm "${q}"` : 'Tất cả sản phẩm',
    description: q
      ? `Kết quả tìm kiếm cho "${q}" — Hàng ngàn sản phẩm chính hãng`
      : 'Khám phá hàng triệu sản phẩm trên HyperCommerce',
  };
}

// Revalidate frequently for search results
export const revalidate = 30;

async function ProductResults({ searchParams }: PageProps) {
  const page = Number(searchParams.page ?? 1);
  const result = await searchProducts({
    q: searchParams.q,
    category: searchParams.category,
    minPrice: searchParams.minPrice ? Number(searchParams.minPrice) : undefined,
    maxPrice: searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined,
    page,
    pageSize: 24,
    sort: (searchParams.sort as 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'popular') ?? 'relevance',
  }).catch((): SearchResult => ({ products: [], total: 0, page: 1, pageSize: 24 }));

  if (result.products.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">🔍</p>
        <h3 className="text-xl font-semibold text-gray-700 mb-2">Không tìm thấy sản phẩm</h3>
        <p className="text-gray-500">Thử tìm kiếm với từ khóa khác</p>
      </div>
    );
  }

  return (
    <>
      {/* Sponsored products at top */}
      {result.sponsored && result.sponsored.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2">Tin được tài trợ</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {result.sponsored.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} showSponsored />
            ))}
          </div>
          <hr className="mt-4" />
        </div>
      )}

      <p className="text-sm text-gray-500 mb-4">
        {result.total.toLocaleString('vi-VN')} kết quả
        {searchParams.q ? ` cho "${searchParams.q}"` : ''}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {result.products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {result.total > 24 && (
        <div className="mt-8 flex justify-center">
          <Pagination
            currentPage={page}
            totalPages={Math.ceil(result.total / 24)}
            baseUrl={`/products?${new URLSearchParams({
              ...(searchParams.q ? { q: searchParams.q } : {}),
              ...(searchParams.category ? { category: searchParams.category } : {}),
              ...(searchParams.sort ? { sort: searchParams.sort } : {}),
            }).toString()}`}
          />
        </div>
      )}
    </>
  );
}

export default function ProductsPage({ searchParams }: PageProps) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-4">
          {/* Sidebar filters */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <ProductFilters
              currentCategory={searchParams.category}
              currentMinPrice={searchParams.minPrice ? Number(searchParams.minPrice) : undefined}
              currentMaxPrice={searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined}
            />
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-semibold">
                {searchParams.q ? `Kết quả: "${searchParams.q}"` : 'Tất cả sản phẩm'}
              </h1>
              <ProductSort currentSort={searchParams.sort} />
            </div>

            <Suspense
              fallback={
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="card">
                      <div className="skeleton aspect-square" />
                      <div className="p-2 space-y-1">
                        <div className="skeleton h-3 w-full" />
                        <div className="skeleton h-4 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              }
            >
              <ProductResults searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
