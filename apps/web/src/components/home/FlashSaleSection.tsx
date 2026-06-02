'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Zap, ArrowRight } from 'lucide-react';
import { ProductCard } from '@/components/product/ProductCard';
import type { Product } from '@/types';

interface FlashSaleSectionProps {
  products: Product[];
}

function Countdown({ endsAt }: { endsAt: string }) {
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 });

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
      setTimeLeft({
        h: Math.floor(diff / 3_600_000),
        m: Math.floor(diff / 60_000) % 60,
        s: Math.floor(diff / 1000) % 60,
      });
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="flex items-center gap-1.5">
      {[pad(timeLeft.h), pad(timeLeft.m), pad(timeLeft.s)].map((val, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span
            className="font-mono font-black text-white text-sm px-2.5 py-1.5 rounded-lg min-w-[36px] text-center"
            style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
          >
            {val}
          </span>
          {i < 2 && <span className="text-white font-black text-lg">:</span>}
        </span>
      ))}
    </div>
  );
}

export function FlashSaleSection({ products }: FlashSaleSectionProps) {
  if (products.length === 0) return null;
  const endsAt = new Date(Date.now() + 2.5 * 3_600_000).toISOString();

  return (
    <div
      className="rounded-3xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #C62828 0%, #EE4D2D 50%, #FF6D00 100%)' }}
    >
      {/* Header row */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 text-white font-black text-lg tracking-wide"
          >
            <Zap className="w-5 h-5 text-yellow-300 fill-current" />
            FLASH SALE
          </div>
          <div className="h-5 w-px bg-white/30" />
          <Countdown endsAt={endsAt} />
        </div>
        <Link
          href="/flash-sale"
          className="flex items-center gap-1.5 text-white/90 hover:text-white text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl"
        >
          Xem tất cả <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Products */}
      <div
        className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
      >
        {products.slice(0, 6).map((product) => (
          <div key={product.id} className="bg-white rounded-2xl overflow-hidden shadow-lg">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}

