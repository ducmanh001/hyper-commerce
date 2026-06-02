import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { formatVND } from '@/lib/format';

interface SellerProfile {
  id:           string;
  businessName: string;
  avatarUrl?:   string;
  bannerUrl?:   string;
  description?: string;
  followerCount: number;
  productCount:  number;
  rating:        number;
  reviewCount:   number;
  responseRate:  number;
  joinedAt:      string;
  tier:          string;
}

interface Product {
  id:        string;
  name:      string;
  price:     number;
  imageUrl?: string;
  rating?:   number;
  soldCount: number;
}

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';

async function getSeller(id: string): Promise<SellerProfile | null> {
  try {
    const res = await fetch(`${GATEWAY}/api/sellers/${id}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getSellerProducts(id: string): Promise<Product[]> {
  try {
    const res = await fetch(`${GATEWAY}/api/sellers/${id}/products?limit=20`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const seller = await getSeller(params.id);
  return {
    title: seller ? `${seller.businessName} | HyperCommerce` : 'Shop | HyperCommerce',
  };
}

const TIER_BADGES: Record<string, string> = {
  FREE:         '',
  BASIC:        '🥉 Cơ bản',
  PROFESSIONAL: '🥈 Chuyên nghiệp',
  ENTERPRISE:   '🥇 Doanh nghiệp',
};

export default async function SellerShopPage({ params }: { params: { id: string } }) {
  const [seller, products] = await Promise.all([getSeller(params.id), getSellerProducts(params.id)]);

  if (!seller) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Banner */}
      <div className="relative h-40 bg-gradient-to-r from-[#EE4D2D] to-orange-400">
        {seller.bannerUrl && (
          <Image src={seller.bannerUrl} alt="banner" fill className="object-cover" priority />
        )}
      </div>

      {/* Profile */}
      <div className="max-w-6xl mx-auto px-4">
        <div className="bg-white rounded-xl shadow-sm p-5 -mt-10 relative z-10 mb-6 border border-gray-100">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-gray-200 flex-shrink-0 -mt-8 sm:mt-0 ring-4 ring-white">
              {seller.avatarUrl ? (
                <Image src={seller.avatarUrl} alt={seller.businessName} fill className="object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-gray-400">
                  {seller.businessName.charAt(0)}
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{seller.businessName}</h1>
                {TIER_BADGES[seller.tier] && (
                  <span className="text-xs bg-[#FFF3F0] text-[#EE4D2D] px-2 py-0.5 rounded-full font-medium">
                    {TIER_BADGES[seller.tier]}
                  </span>
                )}
              </div>
              {seller.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{seller.description}</p>
              )}
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                <div>
                  <span className="font-semibold text-gray-900">{seller.productCount.toLocaleString()}</span>
                  <span className="text-gray-500 ml-1">sản phẩm</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-900">{seller.followerCount.toLocaleString()}</span>
                  <span className="text-gray-500 ml-1">người theo dõi</span>
                </div>
                <div>
                  <span className="font-semibold text-yellow-500">★ {seller.rating.toFixed(1)}</span>
                  <span className="text-gray-500 ml-1">({seller.reviewCount.toLocaleString()} đánh giá)</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-900">{seller.responseRate}%</span>
                  <span className="text-gray-500 ml-1">phản hồi</span>
                </div>
              </div>
            </div>

            <button className="flex-shrink-0 px-6 py-2 border-2 border-[#EE4D2D] text-[#EE4D2D] rounded-xl font-medium text-sm hover:bg-[#EE4D2D] hover:text-white transition-colors">
              + Theo dõi
            </button>
          </div>
        </div>

        {/* Products grid */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Sản phẩm của shop</h2>
        {products.length === 0 ? (
          <div className="text-center py-12 text-gray-500">Shop chưa có sản phẩm</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pb-8">
            {products.map((product) => (
              <Link key={product.id} href={`/product/${product.id}`}>
                <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow group">
                  <div className="relative aspect-square bg-gray-100">
                    {product.imageUrl ? (
                      <Image
                        src={product.imageUrl}
                        alt={product.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 50vw, 20vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl text-gray-200">📦</div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-gray-800 line-clamp-2">{product.name}</p>
                    <p className="text-sm font-bold text-[#EE4D2D] mt-1">{formatVND(product.price)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Đã bán {product.soldCount.toLocaleString()}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
