'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import {
  LayoutDashboard, Users, ShoppingBag, Store, Scale, DollarSign,
  Shield, Key, ClipboardList, Flag, Megaphone, Home, LogOut, ChevronRight,
  BarChart2, Search,
} from 'lucide-react';

interface NavItem {
  href:   string;
  label:  string;
  icon:   React.ReactNode;
  badge?: string;
  roles?: string[];
}

const NAV: NavItem[] = [
  { href: '/admin',               label: 'Dashboard',      icon: <LayoutDashboard className="w-4 h-4" /> },
  { href: '/admin/analytics',     label: 'Analytics',      icon: <BarChart2 className="w-4 h-4" /> },
  { href: '/admin/users',         label: 'Người dùng',     icon: <Users className="w-4 h-4" />, badge: 'NEW' },
  { href: '/admin/orders',        label: 'Đơn hàng',       icon: <ShoppingBag className="w-4 h-4" /> },
  { href: '/admin/sellers',       label: 'Người bán',      icon: <Store className="w-4 h-4" /> },
  { href: '/admin/disputes',      label: 'Tranh chấp',     icon: <Scale className="w-4 h-4" />, badge: '3' },
  { href: '/admin/finance',       label: 'Tài chính',      icon: <DollarSign className="w-4 h-4" />, roles: ['SUPER_ADMIN','ADMIN','FINANCE'] },
  { href: '/admin/fraud',         label: 'Gian lận',       icon: <Shield className="w-4 h-4" />, badge: '5', roles: ['SUPER_ADMIN','ADMIN','TRUST_SAFETY'] },
  { href: '/admin/search',        label: 'Search Index',   icon: <Search className="w-4 h-4" />, roles: ['SUPER_ADMIN','ADMIN'] },
  { href: '/admin/roles',         label: 'Phân quyền',     icon: <Key className="w-4 h-4" />, roles: ['SUPER_ADMIN','ADMIN'] },
  { href: '/admin/audit-logs',    label: 'Nhật ký',        icon: <ClipboardList className="w-4 h-4" />, roles: ['SUPER_ADMIN','ADMIN'] },
  { href: '/admin/feature-flags', label: 'Feature Flags',  icon: <Flag className="w-4 h-4" />, roles: ['SUPER_ADMIN','ADMIN'] },
  { href: '/admin/ads',           label: 'Quảng cáo',      icon: <Megaphone className="w-4 h-4" /> },
];

export function AdminNav() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, clearAuth } = useAuthStore();

  const visible = NAV.filter((item) => !item.roles || item.roles.includes(user?.role ?? ''));

  return (
    <nav className="flex flex-col h-full" style={{ background: 'linear-gradient(180deg, #0F172A 0%, #111827 60%, #0F172A 100%)' }}>

      {/* Brand */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/admin" className="flex items-center gap-2 group">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shadow-lg group-hover:scale-105 transition-transform"
            style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}
          >
            H
          </div>
          <div>
            <span className="text-lg font-black text-white tracking-tight">Hyper</span>
            <span className="text-lg font-black tracking-tight" style={{ color: '#EE4D2D' }}>Admin</span>
          </div>
        </Link>

        {/* User card */}
        {user && (
          <div className="mt-4 flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2.5 border border-white/8">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="w-9 h-9 rounded-xl object-cover ring-2 ring-white/10" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-sm">
                {user.fullName.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">{user.fullName}</p>
              <span
                className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white mt-0.5"
                style={{ background: 'rgba(238,77,45,0.3)', border: '1px solid rgba(238,77,45,0.4)' }}
              >
                {user.role}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-white/8 mb-2" />

      {/* Nav items */}
      <ul className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
        {visible.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/6'
                }`}
                style={isActive ? { background: 'linear-gradient(135deg, rgba(238,77,45,0.25), rgba(238,77,45,0.10))', borderLeft: '3px solid #EE4D2D', paddingLeft: '10px' } : undefined}
              >
                <span
                  className={`flex-shrink-0 transition-colors ${isActive ? 'text-primary-400' : 'text-gray-500 group-hover:text-gray-300'}`}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                      item.badge === 'NEW'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
                {isActive && <ChevronRight className="w-3 h-3 text-primary-400 flex-shrink-0" />}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Bottom actions */}
      <div className="mx-4 h-px bg-white/8 mb-2" />
      <div className="px-3 pb-5 space-y-1">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-white hover:bg-white/6 transition-all"
        >
          <Home className="w-4 h-4" />
          Về trang chủ
        </Link>
        <button
          onClick={() => { clearAuth(); router.push('/auth/login'); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/8 transition-all"
        >
          <LogOut className="w-4 h-4" />
          Đăng xuất
        </button>
      </div>
    </nav>
  );
}

