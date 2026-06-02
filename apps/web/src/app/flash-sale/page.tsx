'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { formatVND } from '@/lib/format';
import { useCartStore } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';

interface FlashSaleSession {
  id:         string;
  name:       string;
  startsAt:   string;
  endsAt:     string;
  products:   FlashProduct[];
}

interface FlashProduct {
  id:           string;
  name:         string;
  imageUrl?:    string;
  originalPrice: number;
  salePrice:    number;
  stock:        number;
  totalSlots:   number;
  soldCount:    number;
}

function useCountdown(endsAt: string) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, new Date(endsAt).getTime() - Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const totalSeconds = Math.floor(remaining / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  return { h, m, s, expired: remaining === 0 };
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="bg-gray-900 text-white font-bold text-2xl w-12 h-12 flex items-center justify-center rounded-lg tabular-nums">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-xs text-gray-500 mt-1">{label}</span>
    </div>
  );
}

export default function FlashSalePage() {
  const [session, setSession]   = useState<FlashSaleSession | null>(null);
  const [loading, setLoading]   = useState(true);
  const addToCart               = useCartStore((s) => s.addItem);
  const { success }             = useToast();

  useEffect(() => {
    fetch('/api/inventory/flash-sale/active')
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const countdown = useCountdown(session?.endsAt ?? new Date(Date.now() + 1).toISOString());

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin text-4xl">⚡</div>
      </div>
    );
  }

  if (!session || countdown.expired) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-4">⏰</p>
          <p className="text-xl font-bold text-gray-800">Chưa có flash sale nào</p>
          <p className="text-gray-500 text-sm mt-2">Hãy quay lại vào buổi chiều nhé!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero banner */}
      <div className="bg-gradient-to-r from-[#EE4D2D] to-[#FF6B50] text-white py-8">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-3xl">⚡</span>
            <h1 className="text-3xl font-black tracking-wide">FLASH SALE</h1>
            <span className="text-3xl">⚡</span>
          </div>
          <p className="text-white/80 mb-6">{session.name}</p>

          {/* Countdown */}
          <div className="flex items-center justify-center gap-3">
            <CountdownUnit value={countdown.h} label="Giờ" />
            <span className="text-2xl font-bold pb-4">:</span>
            <CountdownUnit value={countdown.m} label="Phút" />
            <span className="text-2xl font-bold pb-4">:</span>
            <CountdownUnit value={countdown.s} label="Giây" />
          </div>
        </div>
      </div>

      {/* Products */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {session.products.map((product) => {
            const discountPct = Math.round((1 - product.salePrice / product.originalPrice) * 100);
            const soldPct     = Math.round((product.soldCount / product.totalSlots) * 100);
            const outOfStock  = product.stock <= 0;

            return (
              <div key={product.id} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 group">
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
                    <div className="w-full h-full flex items-center justify-center text-4xl text-gray-200">📦</div>
                  )}
                  <span className="absolute top-2 left-2 bg-[#EE4D2D] text-white text-xs font-bold px-1.5 py-0.5 rounded">
                    -{discountPct}%
                  </span>
                  {outOfStock && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-white font-bold text-sm">Hết hàng</span>
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <p className="text-xs text-gray-800 line-clamp-2 min-h-[2.5rem]">{product.name}</p>

                  <div className="mt-2">
                    <p className="text-[#EE4D2D] font-bold text-sm">{formatVND(product.salePrice)}</p>
                    <p className="text-gray-400 text-xs line-through">{formatVND(product.originalPrice)}</p>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#EE4D2D] to-orange-400 rounded-full transition-all"
                        style={{ width: `${Math.min(soldPct, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Đã bán {soldPct}%</p>
                  </div>

                  <button
                    disabled={outOfStock}
                    onClick={() => {
                      addToCart({ id: product.id, name: product.name, thumbnailUrl: product.imageUrl ?? '', price: product.originalPrice, salePrice: product.salePrice, sellerId: '', sellerName: '', slug: '', description: '', images: [], categoryId: '', categoryName: '', rating: 0, reviewCount: 0, soldCount: 0, stockQuantity: product.stock, tags: [] }, undefined, 1);
                      success('Đã thêm vào giỏ');
                    }}
                    className="mt-2 w-full py-1.5 text-xs bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {outOfStock ? 'Hết hàng' : 'Thêm vào giỏ'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
