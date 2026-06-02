'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Star, ShoppingCart, Heart, Zap } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart';
import { clientApi } from '@/lib/api-client';
import { formatVND, discountPct, truncate } from '@/lib/format';
import { toast } from 'react-toastify';
import type { Product } from '@/types';
import { clsx } from 'clsx';

interface ProductCardProps {
  product: Product;
  compact?: boolean;
  showSponsored?: boolean;
}

export function ProductCard({ product, compact = false, showSponsored = false }: ProductCardProps) {
  const addItem = useCartStore((s) => s.addItem);

  const effectivePrice = product.salePrice ?? product.price;
  const hasDiscount = product.originalPrice && product.originalPrice > effectivePrice;
  const discount = hasDiscount ? discountPct(product.originalPrice!, effectivePrice) : 0;

  async function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    if (product.isSponsored && product.adImpressionId) {
      clientApi.trackAdClick(product.adImpressionId, product.id);
    }
    await addItem(product, undefined, 1);
    toast.success(`Đã thêm vào giỏ hàng 🛒`);
  }

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block bg-white rounded-2xl overflow-hidden transition-all duration-300"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px rgba(0,0,0,0.12)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Image area */}
      <div className={clsx('relative overflow-hidden bg-gray-50', compact ? 'aspect-square' : 'aspect-square')}>
        <Image
          src={product.thumbnailUrl || '/placeholder.svg'}
          alt={product.name}
          fill
          className="object-contain p-2 group-hover:scale-110 transition-transform duration-500"
          sizes={compact ? '120px' : '(max-width: 640px) 50vw, 200px'}
        />

        {/* Discount badge */}
        {discount > 0 && (
          <span
            className="absolute top-2 left-2 text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg"
            style={{ background: 'linear-gradient(135deg,#EE4D2D,#FF6B35)' }}
          >
            -{discount}%
          </span>
        )}

        {/* Flash sale */}
        {product.isFlashSale && (
          <span className="absolute top-2 right-2 flex items-center gap-0.5 text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg"
            style={{ background: 'linear-gradient(135deg,#DC2626,#EE4D2D)', animation: 'flash-pulse 1.2s ease-in-out infinite' }}>
            <Zap className="w-3 h-3 fill-current" /> Flash
          </span>
        )}

        {/* Sponsored */}
        {product.isSponsored && showSponsored && (
          <span className="absolute bottom-2 left-2 badge-sponsored">Tài trợ</span>
        )}

        {/* Hover overlay actions */}
        {!compact && (
          <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
            <div className="flex">
              <button
                onClick={handleAddToCart}
                className="flex-1 py-2.5 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-colors"
                style={{ background: 'linear-gradient(135deg,#EE4D2D,#FF6B35)' }}
                aria-label="Thêm vào giỏ"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                Thêm vào giỏ
              </button>
              <button
                onClick={(e) => { e.preventDefault(); toast.info('Đã thêm vào yêu thích ❤️'); }}
                className="w-10 bg-gray-100 hover:bg-red-50 flex items-center justify-center border-l border-white/30 transition-colors"
                aria-label="Yêu thích"
              >
                <Heart className="w-4 h-4 text-gray-400 hover:text-red-500 transition-colors" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className={clsx('px-3 pb-3', compact ? 'px-2 pb-2 pt-1.5' : 'px-3 pb-3 pt-2')}>
        <p
          className={clsx(
            'text-gray-800 font-semibold leading-tight mb-1.5',
            compact ? 'text-xs line-clamp-1' : 'text-sm line-clamp-2 min-h-[2.5rem]',
          )}
        >
          {product.name}
        </p>

        {/* Price row */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className={clsx('font-black', compact ? 'text-xs' : 'text-base')}
            style={{ color: '#EE4D2D' }}
          >
            {formatVND(effectivePrice)}
          </span>
          {hasDiscount && !compact && (
            <span className="text-xs text-gray-400 line-through font-medium">
              {formatVND(product.originalPrice!)}
            </span>
          )}
        </div>

        {/* Rating + sold */}
        {!compact && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={clsx('w-3 h-3', i < Math.round(product.rating) ? 'fill-yellow-400 text-yellow-400' : 'fill-gray-200 text-gray-200')}
                  />
                ))}
              </div>
              <span className="text-xs text-gray-500">({product.reviewCount?.toLocaleString('vi-VN') ?? 0})</span>
            </div>
            <span className="text-xs text-gray-400">
              {product.soldCount > 999
                ? `${(product.soldCount / 1000).toFixed(1)}k bán`
                : `${product.soldCount} bán`}
            </span>
          </div>
        )}

        {/* Free ship badge */}
        {!compact && product.shippingInfo?.freeShipping && (
          <div className="mt-1.5">
            <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-md border border-green-200">
              🚚 Miễn phí ship
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

