'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

const profileSchema = z.object({
  fullName: z.string().min(2, 'Tối thiểu 2 ký tự').max(60),
  phone:    z.string().regex(/^(0|\+84)[0-9]{8,9}$/, 'Số điện thoại không hợp lệ'),
  email:    z.string().email('Email không hợp lệ'),
});

type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword:     z.string().min(8, 'Tối thiểu 8 ký tự'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Mật khẩu xác nhận không khớp',
  path: ['confirmPassword'],
});

type PasswordForm = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user, updateUser, accessToken } = useAuthStore();
  const { success, error }               = useToast();
  const router                           = useRouter();
  const [tab, setTab]                    = useState<'info' | 'password' | 'address'>('info');
  const [savingInfo, setSavingInfo]      = useState(false);
  const [savingPwd, setSavingPwd]        = useState(false);
  const fileRef                          = useRef<HTMLInputElement>(null);

  const infoForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user?.fullName ?? '', phone: '', email: user?.email ?? '' },
  });

  const pwdForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  if (!user) {
    router.replace('/auth/login');
    return null;
  }

  const handleInfoSubmit = async (data: ProfileForm) => {
    setSavingInfo(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        updateUser({ fullName: data.fullName });
        success('Cập nhật thành công', 'Thông tin của bạn đã được lưu');
      } else {
        error('Cập nhật thất bại');
      }
    } catch {
      error('Lỗi kết nối');
    } finally {
      setSavingInfo(false);
    }
  };

  const handlePwdSubmit = async (data: PasswordForm) => {
    setSavingPwd(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
      });
      if (res.ok) {
        success('Đổi mật khẩu thành công');
        pwdForm.reset();
      } else {
        const d = await res.json();
        error('Không thể đổi mật khẩu', d.message);
      }
    } catch {
      error('Lỗi kết nối');
    } finally {
      setSavingPwd(false);
    }
  };

  const TABS = [
    { key: 'info',     label: 'Hồ sơ' },
    { key: 'password', label: 'Đổi mật khẩu' },
    { key: 'address',  label: 'Địa chỉ' },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Tài khoản của tôi</h1>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Sidebar */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tab === t.key ? 'bg-[#FFF3F0] text-[#EE4D2D]' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="md:col-span-3">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              {tab === 'info' && (
                <>
                  {/* Avatar */}
                  <div className="flex items-center gap-4 mb-6 pb-5 border-b border-gray-100">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200">
                        {user.avatar ? (
                          <Image src={user.avatar} alt={user.fullName} width={64} height={64} className="object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">
                            {user.fullName.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#EE4D2D] text-white rounded-full flex items-center justify-center text-xs shadow"
                        aria-label="Đổi ảnh đại diện"
                      >
                        ✎
                      </button>
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{user.fullName}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                      <p className="text-xs font-medium text-[#EE4D2D] mt-0.5">
                        {user.points.toLocaleString()} điểm
                      </p>
                    </div>
                  </div>

                  <form onSubmit={infoForm.handleSubmit(handleInfoSubmit)} className="space-y-4">
                    {(['fullName', 'phone', 'email'] as const).map((field) => {
                      const labels = { fullName: 'Họ tên', phone: 'Số điện thoại', email: 'Email' };
                      return (
                        <div key={field}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{labels[field]}</label>
                          <input
                            {...infoForm.register(field)}
                            type={field === 'email' ? 'email' : 'text'}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 focus:border-[#EE4D2D]"
                          />
                          {infoForm.formState.errors[field] && (
                            <p className="text-xs text-red-500 mt-1">{infoForm.formState.errors[field]?.message}</p>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="submit"
                      disabled={savingInfo}
                      className="w-full py-2.5 bg-[#EE4D2D] text-white rounded-lg text-sm font-semibold hover:bg-[#d43e20] transition-colors disabled:opacity-50"
                    >
                      {savingInfo ? 'Đang lưu...' : 'Lưu thay đổi'}
                    </button>
                  </form>
                </>
              )}

              {tab === 'password' && (
                <form onSubmit={pwdForm.handleSubmit(handlePwdSubmit)} className="space-y-4">
                  <h3 className="font-semibold text-gray-900 mb-4">Đổi mật khẩu</h3>
                  {[
                    { field: 'currentPassword' as const, label: 'Mật khẩu hiện tại' },
                    { field: 'newPassword'     as const, label: 'Mật khẩu mới' },
                    { field: 'confirmPassword' as const, label: 'Xác nhận mật khẩu mới' },
                  ].map(({ field, label }) => (
                    <div key={field}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                      <input
                        {...pwdForm.register(field)}
                        type="password"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 focus:border-[#EE4D2D]"
                      />
                      {pwdForm.formState.errors[field] && (
                        <p className="text-xs text-red-500 mt-1">{pwdForm.formState.errors[field]?.message}</p>
                      )}
                    </div>
                  ))}
                  <button
                    type="submit"
                    disabled={savingPwd}
                    className="w-full py-2.5 bg-[#EE4D2D] text-white rounded-lg text-sm font-semibold hover:bg-[#d43e20] transition-colors disabled:opacity-50"
                  >
                    {savingPwd ? 'Đang cập nhật...' : 'Đổi mật khẩu'}
                  </button>
                </form>
              )}

              {tab === 'address' && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-4">Địa chỉ của tôi</h3>
                  <p className="text-sm text-gray-500">Tính năng đang phát triển...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
