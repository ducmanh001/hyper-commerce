'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { AdminNav } from '@/components/admin/AdminNav';
import { ToastContainer } from '@/components/ui/Toast';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'TRUST_SAFETY'];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isHydrated } = useAuthStore();
  const router               = useRouter();

  useEffect(() => {
    if (!isHydrated) return;
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      router.replace('/auth/login?redirect=/admin');
    }
  }, [user, isHydrated, router]);

  if (!isHydrated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0F172A,#1E293B)' }}>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl" style={{ background: 'linear-gradient(135deg,#EE4D2D,#FF6B35)' }}>
            ⚙️
          </div>
          <p className="text-white/60 text-sm font-medium animate-pulse">Đang kiểm tra quyền...</p>
        </div>
      </div>
    );
  }

  if (!ADMIN_ROLES.includes(user.role)) return null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#F1F5F9' }}>
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col overflow-hidden shadow-xl">
        <AdminNav />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-shrink-0 h-14 flex items-center justify-between px-6 border-b"
          style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', borderColor: '#E2E8F0' }}
        >
          <div className="text-sm text-gray-500 font-medium">
            Quản trị hệ thống
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2 py-1 rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#EE4D2D,#FF6B35)' }}>
              HyperCommerce Admin
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      <ToastContainer />
    </div>
  );
}
