// Product detail page — SSR with ISR (Incremental Static Regeneration)
// WHY ISR: Generate at build time for popular products (fast), revalidate for stock/price changes
// JSON-LD structured data for Google Shopping rich results

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Script from 'next/script';
import { getProduct, searchProducts } from '@/lib/api-client';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ProductDetail } from '@/components/product/ProductDetail';
import { ProductCard } from '@/components/product/ProductCard';
import { ReviewSection } from '@/components/product/ReviewSection';
import { formatVND } from '@/lib/format';

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const product = await getProduct(params.id).catch(() => null);
  if (!product) return { title: 'Sản phẩm không tồn tại' };

  return {
    title: product.name,
    description: product.description.slice(0, 160),
    openGraph: {
      title: product.name,
      description: product.description.slice(0, 160),
      images: [{ url: product.thumbnailUrl, width: 600, height: 600 }],
      type: 'website',
    },
  };
}

// Revalidate every 5 minutes — price and stock can change
export const revalidate = 300;

export default async function ProductDetailPage({ params }: PageProps) {
  const product = await getProduct(params.id).catch(() => null);
  if (!product) notFound();

  // Related products from same category
  const related = await searchProducts({
    category: product.categoryId,
    pageSize: 8,
  }).catch(() => ({ products: [] }));

  // JSON-LD structured data for Google Shopping
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images,
    sku: params.id,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'VND',
      price: product.salePrice ?? product.price,
      availability:
        product.stockQuantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: product.sellerName },
    },
    aggregateRating:
      product.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: product.rating,
            reviewCount: product.reviewCount,
          }
        : undefined,
  };

  return (
    <div className="min-h-screen">
      <Script
        id="product-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <nav className="text-sm text-gray-500 mb-4" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2">
            <li><a href="/" className="hover:text-primary-500">Trang chủ</a></li>
            <li className="text-gray-300">/</li>
            <li><a href="/products" className="hover:text-primary-500">Sản phẩm</a></li>
            <li className="text-gray-300">/</li>
            <li><a href={`/products?category=${product.categoryId}`} className="hover:text-primary-500">{product.categoryName}</a></li>
            <li className="text-gray-300">/</li>
            <li className="text-gray-700 truncate max-w-xs">{product.name}</li>
          </ol>
        </nav>

        {/* Main product section */}
        <ProductDetail product={product} />

        {/* Reviews */}
        <section className="mt-8 bg-white rounded-lg p-6">
          <h2 className="text-lg font-bold mb-4">Đánh Giá Sản Phẩm</h2>
          <ReviewSection productId={product.id} rating={product.rating} reviewCount={product.reviewCount} />
        </section>

        {/* Related products */}
        {related.products.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold mb-4">Sản Phẩm Liên Quan</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {related.products.slice(0, 8).map((p) => (
                <ProductCard key={p.id} product={p} compact />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
