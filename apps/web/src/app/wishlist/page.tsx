'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useWishlistStore } from '@/lib/store/wishlist';
import { formatVND } from '@/lib/format';
import { useCartStore } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function WishlistPage() {
  const { items, removeItem, clear } = useWishlistStore();
  const addToCart                    = useCartStore((s) => s.addItem);
  const { success }                  = useToast();
  const [clearDialog, setClearDialog] = useState(false);

  const handleAddToCart = useCallback((product: typeof items[number]) => {
    addToCart(product, undefined, 1);
    success('Đã thêm vào giỏ', product.name);
  }, [addToCart, success]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Yêu thích ({items.length})
          </h1>
          {items.length > 0 && (
            <button
              onClick={() => setClearDialog(true)}
              className="text-sm text-red-400 hover:text-red-600 transition-colors"
            >
              Xoá tất cả
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon="❤️"
            title="Chưa có sản phẩm yêu thích"
            message="Nhấn biểu tượng tim trên sản phẩm để lưu vào đây"
            action={
              <Link href="/" className="px-6 py-2.5 bg-[#EE4D2D] text-white rounded-lg text-sm font-medium hover:bg-[#d43e20] transition-colors">
                Khám phá ngay
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {items.map((product) => (
              <div key={product.id} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 group">
                <div className="relative aspect-square bg-gray-100">
                  <Link href={`/product/${product.id}`}>
                    {product.thumbnailUrl ? (
                      <Image
                        src={product.thumbnailUrl}
                        alt={product.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-gray-200">📦</div>
                    )}
                  </Link>
                  <button
                    onClick={() => removeItem(product.id)}
                    className="absolute top-2 right-2 w-7 h-7 bg-white/90 rounded-full flex items-center justify-center text-red-400 hover:text-red-600 shadow-sm transition-colors"
                    aria-label="Bỏ yêu thích"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-3">
                  <Link href={`/product/${product.id}`}>
                    <p className="text-xs text-gray-800 line-clamp-2 hover:text-[#EE4D2D] transition-colors">
                      {product.name}
                    </p>
                  </Link>
                  <p className="text-sm font-bold text-[#EE4D2D] mt-1">{formatVND(product.price)}</p>
                  <button
                    onClick={() => handleAddToCart(product)}
                    className="mt-2 w-full py-1.5 text-xs border border-[#EE4D2D] text-[#EE4D2D] rounded-lg hover:bg-[#EE4D2D] hover:text-white transition-colors font-medium"
                  >
                    Thêm vào giỏ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={clearDialog}
        title="Xoá tất cả"
        message="Bạn có chắc muốn xoá tất cả sản phẩm yêu thích?"
        confirmText="Xoá tất cả"
        danger
        onConfirm={() => { clear(); setClearDialog(false); }}
        onCancel={() => setClearDialog(false)}
      />
    </div>
  );
}
