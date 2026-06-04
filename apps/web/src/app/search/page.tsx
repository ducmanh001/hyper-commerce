// Search results page — Server Component (SSR for SEO)
// Route: /search?q=laptop&category=electronics&minPrice=0&maxPrice=1000000&sort=price_asc&page=1

import { Suspense } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { searchProducts } from '@/lib/api-client';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ProductCard } from '@/components/product/ProductCard';
import { ProductFilters } from '@/components/product/ProductFilters';
import { ProductSort } from '@/components/product/ProductSort';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductCardSkeleton } from '@/components/ui/Skeleton';
import type { SearchResult } from '@/types';

const PAGE_SIZE = 24;

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
  const q = searchParams.q ?? '';
  return {
    title: q ? `Tìm kiếm "${q}" — HyperCommerce` : 'Tìm kiếm — HyperCommerce',
    description: q
      ? `Kết quả tìm kiếm cho "${q}". Tìm thấy hàng ngàn sản phẩm chính hãng.`
      : 'Tìm kiếm sản phẩm trên HyperCommerce.',
  };
}

export const revalidate = 30;

// ── Inner async component — streamed via Suspense ──────────────────────────
async function SearchResults({ searchParams }: PageProps) {
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const sort = (searchParams.sort ?? 'relevance') as
    | 'relevance'
    | 'price_asc'
    | 'price_desc'
    | 'newest'
    | 'popular';

  let result: SearchResult;
  try {
    result = await searchProducts({
      q: searchParams.q,
      category: searchParams.category,
      minPrice: searchParams.minPrice ? Number(searchParams.minPrice) : undefined,
      maxPrice: searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined,
      page,
      pageSize: PAGE_SIZE,
      sort,
    });
  } catch {
    result = { products: [], total: 0, page: 1, pageSize: PAGE_SIZE };
  }

  if (result.products.length === 0) {
    return (
      <EmptyState
        icon={<Search className="w-8 h-8" />}
        title="Không tìm thấy sản phẩm"
        message={
          searchParams.q
            ? `Không có kết quả nào cho "${searchParams.q}". Thử từ khóa khác hoặc bỏ bộ lọc.`
            : 'Nhập từ khóa để tìm kiếm sản phẩm.'
        }
        action={
          <Link
            href="/search"
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ background: 'linear-gradient(135deg,#EE4D2D,#FF6B35)' }}
          >
            Xóa bộ lọc
          </Link>
        }
      />
    );
  }

  const totalPages = Math.ceil(result.total / PAGE_SIZE);

  // Build base URL for pagination (preserves all params except page)
  const paginationBase = `/search?${new URLSearchParams({
    ...(searchParams.q ? { q: searchParams.q } : {}),
    ...(searchParams.category ? { category: searchParams.category } : {}),
    ...(searchParams.minPrice ? { minPrice: searchParams.minPrice } : {}),
    ...(searchParams.maxPrice ? { maxPrice: searchParams.maxPrice } : {}),
    ...(searchParams.sort ? { sort: searchParams.sort } : {}),
  }).toString()}`;

  return (
    <>
      {/* Sponsored products */}
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
      {result.query?.corrected && result.query.corrected !== result.query.original && (
        <p className="text-sm text-blue-600 mb-3">
          Hiển thị kết quả cho{' '}
          <span className="font-medium">&ldquo;{result.query.corrected}&rdquo;</span>
          {' '}— bạn có muốn tìm{' '}
          <Link
            href={`/search?q=${encodeURIComponent(result.query.original)}`}
            className="underline hover:text-blue-800"
          >
            &ldquo;{result.query.original}&rdquo;
          </Link>
          ?
        </p>
      )}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {result.products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex justify-center">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            baseUrl={paginationBase}
          />
        </div>
      )}
    </>
  );
}

// ── Loading skeleton grid ──────────────────────────────────────────────────
function SearchSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function SearchPage({ searchParams }: PageProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Breadcrumb / heading */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-800">
            {searchParams.q ? `Kết quả tìm kiếm: "${searchParams.q}"` : 'Tìm kiếm sản phẩm'}
          </h1>
        </div>

        <div className="flex gap-6">
          {/* Filter sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 sticky top-24">
              <ProductFilters
                currentCategory={searchParams.category}
                currentMinPrice={searchParams.minPrice ? Number(searchParams.minPrice) : undefined}
                currentMaxPrice={searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined}
                basePath="/search"
                searchQuery={searchParams.q}
              />
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Sort bar */}
            <div className="flex items-center justify-between mb-4 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-gray-100">
              <span className="text-sm text-gray-500">
                {searchParams.category
                  ? `Danh mục: ${searchParams.category}`
                  : 'Tất cả danh mục'}
              </span>
              <ProductSort currentSort={searchParams.sort} basePath="/search" />
            </div>

            {/* Results — streamed */}
            <Suspense fallback={<SearchSkeleton />}>
              <SearchResults searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
