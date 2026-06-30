'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { logoutUser } from '@/lib/auth-client';
import {
  LayoutDashboard, BarChart2, Package, Megaphone, Scale, CreditCard,
  Video, CreditCard as SubscriptionIcon, Home, LogOut, ChevronRight,
  TrendingUp, AlertTriangle,
} from 'lucide-react';

interface NavItem {
  href:   string;
  label:  string;
  icon:   React.ReactNode;
  badge?: string;
}

const NAV: NavItem[] = [
  { href: '/seller/dashboard',    label: 'Dashboard',      icon: <LayoutDashboard className="w-4 h-4" /> },
  { href: '/seller/analytics',    label: 'Phân tích',      icon: <BarChart2 className="w-4 h-4" /> },
  { href: '/seller/inventory',    label: 'Kho hàng',       icon: <Package className="w-4 h-4" />, badge: '3' },
  { href: '/seller/ads',          label: 'Quảng cáo',      icon: <Megaphone className="w-4 h-4" /> },
  { href: '/seller/disputes',     label: 'Tranh chấp',     icon: <Scale className="w-4 h-4" />, badge: '1' },
  { href: '/seller/payments',     label: 'Thanh toán',     icon: <CreditCard className="w-4 h-4" /> },
  { href: '/seller/live-streams', label: 'Livestream',     icon: <Video className="w-4 h-4" /> },
  { href: '/seller/subscription', label: 'Gói dịch vụ',   icon: <SubscriptionIcon className="w-4 h-4" /> },
];

export function SellerNav() {
  const pathname = usePathname();
  const router   = useRouter();
  const user = useAuthStore((s) => s.user);

  const handleLogout = async () => {
    await logoutUser();
    router.push('/');
  };

  return (
    <nav className="flex flex-col h-full" style={{ background: 'linear-gradient(180deg, #0F172A 0%, #111827 60%, #0F172A 100%)' }}>
      {/* Brand */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/seller/dashboard" className="flex items-center gap-2 group">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shadow-lg group-hover:scale-105 transition-transform"
            style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}
          >
            S
          </div>
          <div>
            <span className="text-lg font-black text-white tracking-tight">Seller</span>
            <span className="text-lg font-black tracking-tight" style={{ color: '#EE4D2D' }}>Hub</span>
          </div>
        </Link>

        {user && (
          <div className="mt-4 flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2.5 border border-white/10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {(user.fullName ?? user.email)?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate">{user.fullName ?? user.email}</p>
              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(238,77,45,0.3)', color: '#FF8B6B' }}>SELLER</span>
            </div>
          </div>
        )}
      </div>

      {/* Nav links */}
      <div className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/seller/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group relative ${
                isActive
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/8'
              }`}
              style={isActive ? { background: 'linear-gradient(90deg, rgba(238,77,45,0.25), rgba(238,77,45,0.08))', borderLeft: '3px solid #EE4D2D', paddingLeft: '10px' } : {}}
            >
              <span className={isActive ? 'text-[#EE4D2D]' : 'text-gray-500 group-hover:text-gray-300'}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(238,77,45,0.4)', color: '#FF8B6B' }}>{item.badge}</span>
              )}
              {isActive && <ChevronRight className="w-3 h-3 text-[#EE4D2D] opacity-60" />}
            </Link>
          );
        })}
      </div>

      {/* Bottom */}
      <div className="px-3 pb-5 space-y-1 border-t border-white/10 pt-3 mt-3">
        <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/8 transition-all">
          <Home className="w-4 h-4" /><span>Về trang chủ</span>
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="w-4 h-4" /><span>Đăng xuất</span>
        </button>
      </div>
    </nav>
  );
}
