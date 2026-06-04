'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/lib/store/toast';

// ── Schemas ──────────────────────────────────────────────────────────────────

const emailSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
});

const resetSchema = z
  .object({
    otp:             z.string().regex(/^\d{6}$/, 'OTP phải gồm đúng 6 chữ số'),
    password:        z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });

type EmailForm = z.infer<typeof emailSchema>;
type ResetForm = z.infer<typeof resetSchema>;

// ── Shared input focus handlers ───────────────────────────────────────────────

const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
  e.target.style.borderColor = '#EE4D2D';
  e.target.style.boxShadow   = '0 0 0 3px rgba(238,77,45,0.12)';
};
const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
  e.target.style.borderColor = '#E5E7EB';
  e.target.style.boxShadow   = 'none';
};

// ── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ResetPasswordPage() {
  const router             = useRouter();
  const { success, error } = useToast();

  const [step,    setStep]    = useState<1 | 2>(1);
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);

  // Step 1 form
  const {
    register: regEmail,
    handleSubmit: handleEmail,
    formState: { errors: emailErrors },
  } = useForm<EmailForm>({ resolver: zodResolver(emailSchema) });

  // Step 2 form
  const {
    register: regReset,
    handleSubmit: handleReset,
    formState: { errors: resetErrors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  // ── Step 1: request OTP ─────────────────────────────────────────────────
  const onEmailSubmit = async (data: EmailForm) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: data.email }),
      });
      const body = await res.json();
      if (res.ok) {
        setEmail(data.email);
        setStep(2);
        success('OTP đã được gửi', `Kiểm tra hộp thư ${data.email}`);
      } else {
        error('Không thể gửi OTP', body.message ?? 'Email không tồn tại trong hệ thống');
      }
    } catch {
      error('Lỗi kết nối', 'Vui lòng thử lại');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: reset password ──────────────────────────────────────────────
  const onResetSubmit = async (data: ResetForm) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, otp: data.otp, password: data.password }),
      });
      const body = await res.json();
      if (res.ok) {
        success('Đặt lại mật khẩu thành công', 'Vui lòng đăng nhập với mật khẩu mới');
        router.push('/auth/login');
      } else {
        error('Đặt lại thất bại', body.message ?? 'OTP không hợp lệ hoặc đã hết hạn');
      }
    } catch {
      error('Lỗi kết nối', 'Vui lòng thử lại');
    } finally {
      setLoading(false);
    }
  };

  // ── Shared submit button ────────────────────────────────────────────────
  const SubmitButton = ({ label, loadingLabel }: { label: string; loadingLabel: string }) => (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all duration-200 disabled:opacity-60 mt-2"
      style={{
        background:  loading ? '#ccc' : 'linear-gradient(135deg, #EE4D2D, #FF6B35)',
        boxShadow:   loading ? 'none' : '0 4px 20px rgba(238,77,45,0.35)',
      }}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <Spinner />
          {loadingLabel}
        </span>
      ) : label}
    </button>
  );

  return (
    <div
      className="min-h-screen flex items-stretch"
      style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)' }}
    >
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] p-12 relative overflow-hidden">
        {/* Blobs */}
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #EE4D2D, transparent)' }}
        />
        <div
          className="absolute -bottom-12 -right-12 w-72 h-72 rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #FFCA3A, transparent)' }}
        />

        {/* Logo */}
        <Link href="/" className="relative z-10">
          <span className="text-3xl font-black text-white">Hyper</span>
          <span className="text-3xl font-black" style={{ color: '#FFCA3A' }}>Commerce</span>
        </Link>

        {/* Hero text */}
        <div className="relative z-10">
          <h2 className="text-4xl font-black text-white leading-tight mb-4">
            Quên mật khẩu?<br />
            <span style={{ color: '#FFCA3A' }}>Không lo cả.</span>
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-8">
            Nhập email đăng ký — chúng tôi sẽ gửi mã OTP để bạn đặt lại mật khẩu ngay lập tức.
          </p>
          {/* Step indicator */}
          <div className="flex items-center gap-4">
            {[
              { n: 1, label: 'Nhập email' },
              { n: 2, label: 'Đặt lại mật khẩu' },
            ].map(({ n, label }) => (
              <div key={n} className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-colors"
                  style={{
                    background: step >= n ? '#FFCA3A' : 'rgba(255,255,255,0.15)',
                    color:      step >= n ? '#0F172A'  : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {n}
                </div>
                <span
                  className="text-sm font-medium transition-colors"
                  style={{ color: step >= n ? '#FFCA3A' : 'rgba(255,255,255,0.4)' }}
                >
                  {label}
                </span>
                {n < 2 && (
                  <div className="w-8 h-px mx-1" style={{ background: step > n ? '#FFCA3A' : 'rgba(255,255,255,0.2)' }} />
                )}
              </div>
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

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Quên mật khẩu</h1>
              <p className="text-gray-500 text-sm mb-8">
                Nhập địa chỉ email đã đăng ký — chúng tôi sẽ gửi mã OTP 6 chữ số cho bạn.
              </p>

              <form onSubmit={handleEmail(onEmailSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                  <input
                    {...regEmail('email')}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  {emailErrors.email && (
                    <p className="text-xs text-red-500 mt-1.5">{emailErrors.email.message}</p>
                  )}
                </div>

                <SubmitButton label="Gửi mã OTP" loadingLabel="Đang gửi..." />
              </form>

              <p className="text-center text-sm text-gray-500 mt-8">
                Nhớ mật khẩu rồi?{' '}
                <Link href="/auth/login" className="font-bold hover:underline" style={{ color: '#EE4D2D' }}>
                  Đăng nhập
                </Link>
              </p>
            </>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Đặt lại mật khẩu</h1>
              <p className="text-gray-500 text-sm mb-2">
                Mã OTP đã gửi tới <span className="font-semibold text-gray-700">{email}</span>.
              </p>
              <button
                type="button"
                className="text-xs font-medium mb-8 hover:underline"
                style={{ color: '#EE4D2D' }}
                onClick={() => setStep(1)}
              >
                Đổi email
              </button>

              <form onSubmit={handleReset(onResetSubmit)} className="space-y-4">
                {/* OTP */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mã OTP</label>
                  <input
                    {...regReset('otp')}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm tracking-[0.35em] font-mono focus:outline-none transition-all"
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  {resetErrors.otp && (
                    <p className="text-xs text-red-500 mt-1.5">{resetErrors.otp.message}</p>
                  )}
                </div>

                {/* New password */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu mới</label>
                  <input
                    {...regReset('password')}
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  {resetErrors.password && (
                    <p className="text-xs text-red-500 mt-1.5">{resetErrors.password.message}</p>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Xác nhận mật khẩu</label>
                  <input
                    {...regReset('confirmPassword')}
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  {resetErrors.confirmPassword && (
                    <p className="text-xs text-red-500 mt-1.5">{resetErrors.confirmPassword.message}</p>
                  )}
                </div>

                <SubmitButton label="Đặt lại mật khẩu" loadingLabel="Đang xử lý..." />
              </form>

              <p className="text-center text-sm text-gray-500 mt-8">
                Chưa nhận được OTP?{' '}
                <button
                  type="button"
                  className="font-bold hover:underline disabled:opacity-50"
                  style={{ color: '#EE4D2D' }}
                  disabled={loading}
                  onClick={() => {
                    setStep(1);
                  }}
                >
                  Gửi lại
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
