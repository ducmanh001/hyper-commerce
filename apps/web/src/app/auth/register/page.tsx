'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

const registerSchema = z.object({
  fullName:        z.string().min(2, 'Tối thiểu 2 ký tự').max(60),
  email:           z.string().email('Email không hợp lệ'),
  phone:           z.string().regex(/^(0|\+84)[0-9]{8,9}$/, 'Số điện thoại không hợp lệ'),
  password:        z.string().min(8, 'Tối thiểu 8 ký tự'),
  confirmPassword: z.string(),
  agree:           z.literal(true, { errorMap: () => ({ message: 'Bạn cần đồng ý điều khoản' }) }),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Mật khẩu xác nhận không khớp',
  path: ['confirmPassword'],
});

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router             = useRouter();
  const { setAuth }        = useAuthStore();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: data.fullName,
          email:    data.email,
          phone:    data.phone,
          password: data.password,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setAuth(body.user, body.accessToken, body.refreshToken);
        success('Đăng ký thành công', `Chào mừng ${body.user.fullName}!`);
        router.push('/');
      } else {
        error('Đăng ký thất bại', body.message ?? 'Đã có lỗi xảy ra');
      }
    } catch {
      error('Lỗi kết nối', 'Vui lòng thử lại');
    } finally {
      setLoading(false);
    }
  };

  const FIELDS: Array<{ name: keyof RegisterForm; label: string; type: string; placeholder: string }> = [
    { name: 'fullName',        label: 'Họ và tên',             type: 'text',     placeholder: 'Nguyễn Văn A' },
    { name: 'email',           label: 'Email',                  type: 'email',    placeholder: 'you@example.com' },
    { name: 'phone',           label: 'Số điện thoại',          type: 'tel',      placeholder: '0901 234 567' },
    { name: 'password',        label: 'Mật khẩu',               type: 'password', placeholder: '••••••••' },
    { name: 'confirmPassword', label: 'Xác nhận mật khẩu',      type: 'password', placeholder: '••••••••' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 w-full max-w-sm p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-2xl font-black text-[#EE4D2D] tracking-tight">HyperCommerce</span>
          </Link>
          <p className="text-gray-500 text-sm mt-2">Tạo tài khoản mới</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {FIELDS.map(({ name, label, type, placeholder }) => (
            <div key={name}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                {...register(name)}
                type={type}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 focus:border-[#EE4D2D] transition-colors"
              />
              {errors[name] && (
                <p className="text-xs text-red-500 mt-1">{errors[name]?.message as string}</p>
              )}
            </div>
          ))}

          {/* Terms */}
          <div className="flex items-start gap-2">
            <input
              {...register('agree')}
              type="checkbox"
              id="agree"
              className="mt-0.5 accent-[#EE4D2D]"
            />
            <label htmlFor="agree" className="text-xs text-gray-500">
              Tôi đồng ý với{' '}
              <Link href="/terms" className="text-[#EE4D2D] hover:underline">Điều khoản sử dụng</Link>
              {' '}và{' '}
              <Link href="/privacy" className="text-[#EE4D2D] hover:underline">Chính sách bảo mật</Link>
            </label>
          </div>
          {errors.agree && <p className="text-xs text-red-500">{errors.agree.message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#EE4D2D] text-white rounded-lg font-semibold text-sm hover:bg-[#d43e20] transition-colors disabled:opacity-50"
          >
            {loading ? 'Đang đăng ký...' : 'Đăng ký'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Đã có tài khoản?{' '}
          <Link href="/auth/login" className="text-[#EE4D2D] font-medium hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  );
}
