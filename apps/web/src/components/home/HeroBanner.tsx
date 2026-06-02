'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Zap, ArrowRight, ShieldCheck, Truck, Star } from 'lucide-react';

const SLIDES = [
  {
    tag: '⚡ Flash Sale hôm nay',
    headline: ['Mua Sắm Thông Minh,', 'Sống Chất Hơn'],
    accent: 'Tiết Kiệm Đến 70%',
    sub: 'Hàng triệu sản phẩm chính hãng. Bảo vệ người mua 100%. Flash sale mỗi ngày.',
    cta1: { label: '⚡ Flash Sale ngay', href: '/flash-sale' },
    cta2: { label: 'Khám phá', href: '/products' },
    emoji: '🚀',
    color: 'from-[#B82D12] via-[#EE4D2D] to-[#FF7043]',
  },
  {
    tag: '🔴 Mới ra mắt',
    headline: ['Điện Thoại & Laptop', 'Chính Hãng Giá Tốt'],
    accent: 'Trả Góp 0%',
    sub: 'Samsung, Apple, ASUS, Sony — cam kết chính hãng, giao nhanh 2 giờ nội thành.',
    cta1: { label: '📱 Xem Điện Tử', href: '/products?category=electronics' },
    cta2: { label: 'So sánh giá', href: '/products' },
    emoji: '📱',
    color: 'from-[#1a237e] via-[#283593] to-[#3949AB]',
  },
  {
    tag: '👗 Xu hướng 2026',
    headline: ['Thời Trang Hè Rực Rỡ', 'Phong Cách Mới'],
    accent: 'Miễn Phí Ship',
    sub: 'Nike, Uniqlo, Adidas và hàng ngàn thương hiệu. Mix & match phong cách của bạn.',
    cta1: { label: '👗 Khám phá Fashion', href: '/products?category=fashion' },
    cta2: { label: 'Xem Live Shop', href: '/live' },
    emoji: '✨',
    color: 'from-[#4A148C] via-[#6A1B9A] to-[#8E24AA]',
  },
];

const TRUST = [
  { icon: <ShieldCheck className="w-4 h-4" />, label: 'Bảo vệ 100%' },
  { icon: <Truck className="w-4 h-4" />, label: 'Giao 2h nội thành' },
  { icon: <Star className="w-4 h-4 fill-current" />, label: '5M+ đánh giá 5★' },
];

export function HeroBanner() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCurrent((c) => (c + 1) % SLIDES.length), 5000);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDES[current];

  return (
    <div className="relative overflow-hidden py-12 hero-pattern min-h-[320px] flex flex-col justify-between">
      {/* Animated blobs */}
      <div
        className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-20 blur-3xl pointer-events-none animate-float"
        style={{ background: 'radial-gradient(circle, #FFCA3A, transparent)' }}
      />
      <div
        className="absolute -bottom-10 -left-10 w-56 h-56 rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #fff, transparent)', animationDelay: '1s' }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="text-white max-w-xl">
          {/* Tag */}
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur px-4 py-1.5 rounded-full text-sm font-semibold mb-5 border border-white/20">
            <span>{slide.tag}</span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl md:text-[2.75rem] font-black leading-tight mb-2 drop-shadow-sm">
            {slide.headline[0]}
            <br />
            <span>{slide.headline[1]}</span>
          </h1>

          {/* Accent */}
          <div className="inline-block bg-yellow-400 text-gray-900 font-black text-lg px-4 py-1 rounded-xl mb-4 shadow-lg">
            {slide.accent}
          </div>

          <p className="text-white/80 text-base mb-7 leading-relaxed max-w-md">{slide.sub}</p>

          {/* CTAs */}
          <div className="flex gap-3 flex-wrap">
            <Link
              href={slide.cta1.href}
              className="inline-flex items-center gap-2 font-bold px-6 py-3 rounded-xl transition-all duration-200 shadow-lg text-gray-900"
              style={{ background: 'linear-gradient(135deg, #FFCA3A, #F5A623)' }}
            >
              {slide.cta1.label}
            </Link>
            <Link
              href={slide.cta2.href}
              className="inline-flex items-center gap-2 font-semibold px-6 py-3 rounded-xl transition-all duration-200 text-white border-2 border-white/30 hover:bg-white/15 backdrop-blur"
            >
              {slide.cta2.label}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Right: emoji + stats */}
        <div className="hidden md:flex flex-col items-center gap-4">
          <div className="text-[6rem] animate-float drop-shadow-xl">{slide.emoji}</div>
          <div className="flex gap-3">
            {[
              { n: '10M+', label: 'Sản phẩm' },
              { n: '5M+', label: 'Người dùng' },
              { n: '99%', label: 'Hài lòng' },
            ].map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center bg-white/15 backdrop-blur rounded-2xl px-4 py-3 border border-white/20"
              >
                <span className="text-2xl font-black text-yellow-300">{s.n}</span>
                <span className="text-xs text-white/70">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trust badges */}
      <div className="relative z-10 flex gap-4 mt-6 flex-wrap">
        {TRUST.map((t) => (
          <div
            key={t.label}
            className="flex items-center gap-2 text-white/90 bg-white/10 backdrop-blur px-3 py-1.5 rounded-full text-xs font-medium border border-white/15"
          >
            {t.icon}
            {t.label}
          </div>
        ))}
      </div>

      {/* Slide indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`rounded-full transition-all duration-300 ${
              i === current ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-white/40'
            }`}
            aria-label={`Slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

