'use client';

import Link from 'next/link';
import { ShoppingCart, Search, Bell, User, LogOut, BarChart2, Package, Heart, Zap, ChevronDown, X, Menu } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart';
import { useAuthStore } from '@/lib/store/auth';
import { logoutUser } from '@/lib/auth-client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function Header() {
  const getItemCount = useCartStore((s) => s.getItemCount);
  const itemCount = getItemCount();
  const user = useAuthStore((s) => s.user);
  const [query, setQuery]       = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const router = useRouter();
  const userRef = useRef<HTMLDivElement>(null);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) router.push(`/products?q=${encodeURIComponent(query.trim())}`);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="sticky top-0 z-50">
      {/* Top promo bar */}
      <div className="bg-gradient-to-r from-[#1a0a00] via-[#3D1200] to-[#1a0a00] text-center py-1.5 text-xs text-orange-200 font-medium tracking-wide">
        🎉 Flash Sale mỗi ngày 12:00 &amp; 20:00 — Miễn phí vận chuyển đơn từ 199K &nbsp;|&nbsp; 🛡️ Bảo vệ người mua 100%
      </div>

      {/* Main header */}
      <div
        className="text-white"
        style={{ background: 'linear-gradient(135deg, #C63C22 0%, #EE4D2D 45%, #FF6B35 100%)' }}
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-4 h-[60px]">

            {/* Mobile hamburger */}
            <button className="md:hidden text-white/90 hover:text-white" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Logo */}
            <Link href="/" className="flex-shrink-0 flex items-center gap-1">
              <span className="text-2xl font-black tracking-tight text-white drop-shadow">Hyper</span>
              <span
                className="text-2xl font-black tracking-tight"
                style={{ color: '#FFCA3A', textShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              >Commerce</span>
            </Link>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-2xl hidden md:flex">
              <div className="flex w-full rounded-xl overflow-hidden shadow-lg ring-2 ring-white/20 focus-within:ring-yellow-300/60 transition-all">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm điện thoại, thời trang, mỹ phẩm..."
                  className="flex-1 px-4 py-2.5 text-gray-900 text-sm focus:outline-none bg-white placeholder:text-gray-400"
                />
                <button
                  type="submit"
                  className="px-5 font-semibold text-sm text-gray-800 flex items-center gap-2 transition-colors"
                  style={{ background: 'linear-gradient(135deg, #FFCA3A, #F5A623)' }}
                >
                  <Search className="w-4 h-4" />
                  <span className="hidden sm:inline">Tìm</span>
                </button>
              </div>
            </form>

            {/* Right actions */}
            <div className="flex items-center gap-1 ml-auto md:ml-0">

              {/* Flash sale shortcut */}
              <Link
                href="/flash-sale"
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-xs font-semibold border border-white/20"
              >
                <Zap className="w-3.5 h-3.5 text-yellow-300" fill="currentColor" />
                Flash Sale
              </Link>

              {/* Wishlist */}
              <Link
                href="/wishlist"
                className="relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/15 transition-colors"
                aria-label="Yêu thích"
              >
                <Heart className="w-5 h-5" />
              </Link>

              {/* Notifications */}
              <Link
                href="/notifications"
                className="relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/15 transition-colors"
                aria-label="Thông báo"
              >
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-yellow-400 rounded-full ring-2 ring-[#EE4D2D]" />
              </Link>

              {/* Cart */}
              <Link
                href="/cart"
                className="relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/15 transition-colors"
                aria-label="Giỏ hàng"
              >
                <ShoppingCart className="w-5 h-5" />
                {itemCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1
                               rounded-full text-[10px] font-black flex items-center justify-center text-gray-900"
                    style={{ background: '#FFCA3A' }}
                  >
                    {itemCount > 99 ? '99+' : itemCount}
                  </span>
                )}
              </Link>

              {/* User dropdown */}
              <div className="relative" ref={userRef}>
                <button
                  onClick={() => setUserOpen(!userOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-white/15 transition-colors text-sm font-medium"
                >
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" className="w-7 h-7 rounded-full ring-2 ring-white/40 object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                  <span className="hidden sm:block max-w-[80px] truncate">
                    {user ? user.fullName.split(' ').at(-1) : 'Đăng nhập'}
                  </span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${userOpen ? 'rotate-180' : ''}`} />
                </button>

                {userOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 w-56 rounded-2xl shadow-2xl overflow-hidden animate-fade-up"
                    style={{ background: 'white', border: '1px solid rgba(0,0,0,0.08)' }}
                  >
                    {user ? (
                      <>
                        <div className="px-4 py-3 bg-gradient-to-r from-primary-50 to-orange-50 border-b border-gray-100">
                          <p className="font-semibold text-sm text-gray-900">{user.fullName}</p>
                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                          {user.role === 'ADMIN' && (
                            <span className="inline-block mt-1 text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">ADMIN</span>
                          )}
                        </div>
                        <div className="py-1 text-sm text-gray-700">
                          <Link href="/profile" onClick={() => setUserOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                            <User className="w-4 h-4 text-gray-400" /> Tài khoản
                          </Link>
                          <Link href="/orders" onClick={() => setUserOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                            <Package className="w-4 h-4 text-gray-400" /> Đơn hàng
                          </Link>
                          <Link href="/points" onClick={() => setUserOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                            <span className="w-4 h-4 text-center text-sm">🏆</span> Điểm thưởng
                          </Link>
                          {(user.role === 'SELLER' || user.role === 'ADMIN') && (
                            <Link href="/seller/dashboard" onClick={() => setUserOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                              <BarChart2 className="w-4 h-4 text-gray-400" /> Kênh người bán
                            </Link>
                          )}
                          {user.role === 'ADMIN' && (
                            <Link href="/admin" onClick={() => setUserOpen(false)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-red-600 transition-colors">
                              <span className="w-4 h-4 text-center">⚙️</span> Admin Panel
                            </Link>
                          )}
                          <hr className="my-1 border-gray-100" />
                          <button
                            onClick={async () => {
                              await logoutUser();
                              setUserOpen(false);
                              router.push('/');
                            }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-red-500 transition-colors"
                          >
                            <LogOut className="w-4 h-4" /> Đăng xuất
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="p-4 space-y-2">
                        <Link
                          href="/auth/login"
                          onClick={() => setUserOpen(false)}
                          className="btn-primary w-full text-center py-2.5 text-sm"
                        >
                          Đăng nhập
                        </Link>
                        <Link
                          href="/auth/register"
                          onClick={() => setUserOpen(false)}
                          className="btn-outline w-full text-center py-2.5 text-sm"
                        >
                          Đăng ký
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile search */}
      <div className="md:hidden px-3 py-2 bg-primary-600">
        <form onSubmit={handleSearch} className="flex rounded-xl overflow-hidden shadow ring-2 ring-white/20">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm kiếm sản phẩm..."
            className="flex-1 px-3 py-2 text-sm text-gray-900 focus:outline-none bg-white"
          />
          <button type="submit" className="px-4 bg-yellow-400 text-gray-900">
            <Search className="w-4 h-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
