// Homepage — Server Component (SSR for SEO + fast initial load)
// WHY SERVER COMPONENT: Product data and flash sale countdown should be
// pre-rendered so crawlers see real content without waiting for JS hydration.

import { Suspense } from 'react';
import { getFlashSaleProducts, getFeaturedProducts } from '@/lib/api-client';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ProductCard } from '@/components/product/ProductCard';
import { FlashSaleSection } from '@/components/home/FlashSaleSection';
import { CategoryNav } from '@/components/home/CategoryNav';
import { LiveStreamCard } from '@/components/live/LiveStreamCard';
import { HeroBanner } from '@/components/home/HeroBanner';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HyperCommerce — Mua sắm thông minh, giao hàng nhanh',
  description:
    'Hàng triệu sản phẩm từ các nhà bán hàng uy tín. Flash sale hàng ngày. Bảo vệ người mua 100%.',
};

// Revalidate every 60s — homepage content changes with flash sales
export const revalidate = 60;

async function FeaturedProductsSection() {
  let products = await getFeaturedProducts().catch(() => []);
  if (products.length === 0) {
    // Fallback: show skeleton placeholders rather than error
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="card">
            <div className="skeleton aspect-square w-full" />
            <div className="p-2 space-y-2">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {products.slice(0, 24).map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export default async function HomePage() {
  return (
    <div className="min-h-screen">
      <Header />

      <main>
        {/* Hero Banner */}
        <section className="bg-gradient-to-r from-primary-500 to-primary-600">
          <div className="max-w-7xl mx-auto px-4">
            <HeroBanner />
          </div>
        </section>

        {/* Category Navigation */}
        <section className="bg-white shadow-sm sticky top-16 z-30">
          <div className="max-w-7xl mx-auto px-4">
            <CategoryNav />
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-10">

          {/* Flash Sale Section */}
          <section>
            <Suspense fallback={<div className="skeleton h-64 w-full rounded-lg" />}>
              <FlashSaleSectionServer />
            </Suspense>
          </section>

          {/* Live Now Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500 animate-flash-pulse" />
                Đang Live
              </h2>
              <a href="/live" className="text-primary-500 text-sm font-medium hover:underline">
                Xem tất cả →
              </a>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Placeholder live streams — real data from WebSocket/live-service */}
              {[1, 2, 3, 4].map((i) => (
                <LiveStreamCard key={i} />
              ))}
            </div>
          </section>

          {/* Featured Products */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Gợi Ý Hôm Nay</h2>
              <a href="/products" className="text-primary-500 text-sm font-medium hover:underline">
                Xem thêm →
              </a>
            </div>
            <Suspense
              fallback={
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="card">
                      <div className="skeleton aspect-square" />
                      <div className="p-2 space-y-1">
                        <div className="skeleton h-3 w-full" />
                        <div className="skeleton h-3 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              }
            >
              <FeaturedProductsSection />
            </Suspense>
          </section>

        </div>
      </main>

      <Footer />
    </div>
  );
}

// Separate async component for flash sale so it streams independently
async function FlashSaleSectionServer() {
  const products = await getFlashSaleProducts().catch(() => []);
  return <FlashSaleSection products={products} />;
}
