'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ShoppingCart, Heart, Star, Shield, Truck, RotateCcw } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart';
import { toast } from 'react-toastify';
import { formatVND, discountPct } from '@/lib/format';
import type { Product } from '@/types';

export function ProductDetail({ product }: { product: Product }) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(
    product.variants?.[0]?.id,
  );
  const [quantity, setQuantity] = useState(1);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  const activeVariant = product.variants?.find((v) => v.id === selectedVariantId);
  const effectivePrice = activeVariant?.price ?? product.salePrice ?? product.price;
  const hasDiscount = product.originalPrice && product.originalPrice > effectivePrice;
  const stockQty = activeVariant?.stockQuantity ?? product.stockQuantity;

  async function handleAddToCart() {
    if (stockQty === 0) return;
    await addItem(product, selectedVariantId, quantity);
    toast.success('Đã thêm vào giỏ hàng! 🛒');
  }

  function handleBuyNow() {
    void addItem(product, selectedVariantId, quantity).then(() => {
      window.location.href = '/checkout';
    });
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Images */}
        <div className="md:w-80 lg:w-96 flex-shrink-0">
          <div className="relative aspect-square bg-gray-50 rounded-lg overflow-hidden mb-3">
            <Image
              src={product.images[selectedImageIdx] ?? product.thumbnailUrl}
              alt={product.name}
              fill
              className="object-contain p-4"
              sizes="(max-width: 768px) 100vw, 400px"
              priority
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {product.images.map((img, i) => (
              <button
                key={i}
                onClick={() => setSelectedImageIdx(i)}
                className={`w-14 h-14 border-2 rounded flex-shrink-0 overflow-hidden ${
                  i === selectedImageIdx ? 'border-primary-500' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Image src={img} alt="" width={56} height={56} className="object-contain w-full h-full" />
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {product.isSponsored && (
            <span className="badge-sponsored mb-2 inline-block">Tin được tài trợ</span>
          )}
          <h1 className="text-xl font-bold text-gray-900 mb-3">{product.name}</h1>

          {/* Rating + sold */}
          <div className="flex items-center gap-4 mb-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-yellow-600">{product.rating.toFixed(1)}</span>
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`w-4 h-4 ${i < Math.round(product.rating) ? 'fill-yellow-400 stroke-yellow-400' : 'stroke-gray-300'}`}
                  />
                ))}
              </div>
              <span className="text-gray-400">({product.reviewCount.toLocaleString('vi-VN')} đánh giá)</span>
            </div>
            <span className="text-gray-400">|</span>
            <span>{product.soldCount.toLocaleString('vi-VN')} đã bán</span>
          </div>

          {/* Price */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-extrabold text-primary-500">{formatVND(effectivePrice)}</span>
              {hasDiscount && (
                <>
                  <span className="text-lg text-gray-400 line-through">{formatVND(product.originalPrice!)}</span>
                  <span className="badge-discount">{discountPct(product.originalPrice!, effectivePrice)}% GIẢM</span>
                </>
              )}
            </div>
          </div>

          {/* Variants */}
          {product.variants && product.variants.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Phân loại hàng:</p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                    disabled={v.stockQuantity === 0}
                    className={`px-3 py-1.5 text-sm border-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      selectedVariantId === v.id
                        ? 'border-primary-500 bg-primary-50 text-primary-600 font-medium'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {v.name}
                    {v.stockQuantity === 0 && ' (Hết hàng)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="flex items-center gap-3 mb-6">
            <span className="text-sm font-medium text-gray-700">Số lượng:</span>
            <div className="flex items-center border rounded-md">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-50 transition-colors text-gray-600"
              >
                –
              </button>
              <span className="w-10 text-center font-medium text-sm">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => Math.min(stockQty, q + 1))}
                disabled={quantity >= stockQty}
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-50 transition-colors text-gray-600 disabled:opacity-40"
              >
                +
              </button>
            </div>
            <span className="text-sm text-gray-400">{stockQty} sản phẩm có sẵn</span>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={handleAddToCart}
              disabled={stockQty === 0}
              className="flex items-center gap-2 px-6 py-3 border-2 border-primary-500 text-primary-500 font-semibold rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingCart className="w-5 h-5" />
              Thêm vào giỏ hàng
            </button>
            <button
              onClick={handleBuyNow}
              disabled={stockQty === 0}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {stockQty === 0 ? 'Hết hàng' : 'Mua ngay'}
            </button>
            <button
              onClick={() => setIsWishlisted((w) => !w)}
              className={`p-3 rounded-lg border-2 transition-colors ${isWishlisted ? 'border-red-400 bg-red-50 text-red-500' : 'border-gray-200 hover:border-gray-300 text-gray-400'}`}
              aria-label="Yêu thích"
            >
              <Heart className={`w-5 h-5 ${isWishlisted ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Trust badges */}
          <div className="grid grid-cols-3 gap-3 text-xs text-gray-600">
            <div className="flex items-center gap-1.5 bg-gray-50 rounded p-2">
              <Shield className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>Bảo vệ người mua</span>
            </div>
            <div className="flex items-center gap-1.5 bg-gray-50 rounded p-2">
              <Truck className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span>Giao hàng toàn quốc</span>
            </div>
            <div className="flex items-center gap-1.5 bg-gray-50 rounded p-2">
              <RotateCcw className="w-4 h-4 text-orange-500 flex-shrink-0" />
              <span>Đổi trả 7 ngày</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
