'use client';

import { SellerNav } from '@/components/seller/SellerNav';
import { useAuthStore } from '@/lib/store/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { user, isHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isHydrated && (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN'))) {
      router.push('/auth/login');
    }
  }, [isHydrated, user, router]);

  if (!isHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0F172A, #1E293B)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-2xl animate-pulse" style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>S</div>
          <p className="text-white/60 text-sm">Đang tải Seller Hub...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#F1F5F9' }}>
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 fixed top-0 left-0 h-full z-30 shadow-xl">
        <SellerNav />
      </aside>

      {/* Main content */}
      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 sticky top-0 z-20 border-b border-gray-200/80"
          style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-semibold text-gray-900">Seller Hub</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/seller/ads" className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all text-white"
              style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
              + Tạo quảng cáo
            </a>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
