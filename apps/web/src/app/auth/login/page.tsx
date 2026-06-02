'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

const loginSchema = z.object({
  email:    z.string().email('Email không hợp lệ'),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router             = useRouter();
  const { setAuth }        = useAuthStore();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (res.ok) {
        setAuth(body.user, body.accessToken, body.refreshToken);
        success('Đăng nhập thành công', `Xin chào ${body.user.fullName}!`);
        router.push('/');
      } else {
        error('Đăng nhập thất bại', body.message ?? 'Email hoặc mật khẩu không đúng');
      }
    } catch {
      error('Lỗi kết nối', 'Vui lòng thử lại');
    } finally {
      setLoading(false);
    }
  };

  const OAUTH_PROVIDERS = [
    { id: 'google',   label: 'Tiếp tục với Google',   icon: 'G', bg: 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50' },
    { id: 'facebook', label: 'Tiếp tục với Facebook',  icon: 'f', bg: 'bg-[#1877F2] text-white hover:bg-[#1664d8]' },
  ];

  return (
    <div
      className="min-h-screen flex items-stretch"
      style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)' }}
    >
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] p-12 relative overflow-hidden">
        {/* Blobs */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #EE4D2D, transparent)' }} />
        <div className="absolute -bottom-12 -right-12 w-72 h-72 rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #FFCA3A, transparent)' }} />

        {/* Logo */}
        <Link href="/" className="relative z-10">
          <span className="text-3xl font-black text-white">Hyper</span>
          <span className="text-3xl font-black" style={{ color: '#FFCA3A' }}>Commerce</span>
        </Link>

        {/* Hero text */}
        <div className="relative z-10">
          <h2 className="text-4xl font-black text-white leading-tight mb-4">
            Mua sắm thông minh.<br />
            <span style={{ color: '#FFCA3A' }}>Sống chất hơn.</span>
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-8">
            Hàng triệu sản phẩm chính hãng. Flash sale mỗi ngày.<br />
            Giao hàng 2 giờ nội thành. Bảo vệ người mua 100%.
          </p>
          <div className="flex gap-3 flex-wrap">
            {['10M+ sản phẩm', '5M+ thành viên', '99% hài lòng'].map((t) => (
              <span
                key={t}
                className="text-sm font-semibold text-white/70 bg-white/10 border border-white/15 px-3 py-1.5 rounded-full"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-white/30 text-xs">© 2026 HyperCommerce. Bảo lưu mọi quyền.</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white lg:rounded-l-[2.5rem]">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="text-center mb-8 lg:hidden">
            <Link href="/">
              <span className="text-2xl font-black" style={{ color: '#EE4D2D' }}>HyperCommerce</span>
            </Link>
          </div>

          <h1 className="text-2xl font-black text-gray-900 mb-1">Đăng nhập</h1>
          <p className="text-gray-500 text-sm mb-8">Chào mừng trở lại! Vui lòng nhập thông tin của bạn.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
              <input
                {...register('email')}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': '#EE4D2D40' } as React.CSSProperties}
                onFocus={(e) => { e.target.style.borderColor = '#EE4D2D'; e.target.style.boxShadow = '0 0 0 3px rgba(238,77,45,0.12)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.boxShadow = 'none'; }}
              />
              {errors.email && <p className="text-xs text-red-500 mt-1.5">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-semibold text-gray-700">Mật khẩu</label>
                <Link href="/auth/forgot-password" className="text-xs font-medium hover:underline" style={{ color: '#EE4D2D' }}>
                  Quên mật khẩu?
                </Link>
              </div>
              <input
                {...register('password')}
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                onFocus={(e) => { e.target.style.borderColor = '#EE4D2D'; e.target.style.boxShadow = '0 0 0 3px rgba(238,77,45,0.12)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.boxShadow = 'none'; }}
              />
              {errors.password && <p className="text-xs text-red-500 mt-1.5">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all duration-200 disabled:opacity-60 mt-2"
              style={{
                background: loading ? '#ccc' : 'linear-gradient(135deg, #EE4D2D, #FF6B35)',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(238,77,45,0.35)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Đang đăng nhập...
                </span>
              ) : 'Đăng nhập'}
            </button>
          </form>

          {/* Demo hint */}
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <strong>Demo:</strong> <code>admin@hypercommerce.vn</code> / <code>password</code>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-gray-400 font-medium">hoặc tiếp tục với</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {OAUTH_PROVIDERS.map((p) => (
              <a
                key={p.id}
                href={`/api/auth/${p.id}`}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${p.bg}`}
              >
                <span className="font-black text-base leading-none">{p.icon}</span>
                {p.label}
              </a>
            ))}
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            Chưa có tài khoản?{' '}
            <Link href="/auth/register" className="font-bold hover:underline" style={{ color: '#EE4D2D' }}>
              Đăng ký miễn phí
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
