'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { EmptyState } from '@/components/ui/EmptyState';

interface Referral {
  id:             string;
  referredUser:   string;
  status:         'PENDING' | 'QUALIFIED' | 'REWARDED';
  rewardPoints:   number;
  createdAt:      string;
}

export default function ReferralPage() {
  const { user, accessToken }           = useAuthStore();
  const { success, error }              = useToast();
  const [referrals]                     = useState<Referral[]>([]);
  const [copied, setCopied]             = useState(false);

  const referralLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/register?ref=${user?.id ?? ''}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      success('Đã sao chép', 'Chia sẻ link với bạn bè để nhận điểm thưởng');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      error('Không thể sao chép', 'Vui lòng sao chép thủ công');
    }
  }, [referralLink, success, error]);

  const totalEarned  = referrals.reduce((sum, r) => sum + (r.status === 'REWARDED' ? r.rewardPoints : 0), 0);
  const pendingCount = referrals.filter((r) => r.status === 'PENDING').length;

  const STATUS_LABELS: Record<Referral['status'], string> = {
    PENDING:   'Chờ xác nhận',
    QUALIFIED: 'Đủ điều kiện',
    REWARDED:  'Đã thưởng',
  };

  const STATUS_COLORS: Record<Referral['status'], string> = {
    PENDING:   'text-yellow-600 bg-yellow-50',
    QUALIFIED: 'text-blue-600 bg-blue-50',
    REWARDED:  'text-green-600 bg-green-50',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="bg-gradient-to-br from-[#EE4D2D] to-orange-400 rounded-2xl p-6 text-white text-center mb-6">
          <p className="text-4xl mb-3">🎁</p>
          <h1 className="text-2xl font-black">Giới thiệu bạn bè</h1>
          <p className="text-white/80 text-sm mt-2">
            Mỗi bạn bè đăng ký thành công — cả hai đều nhận <span className="font-bold text-white">500 điểm</span>
          </p>

          {/* Stats */}
          <div className="flex justify-center gap-8 mt-5">
            <div>
              <p className="text-2xl font-black">{referrals.length}</p>
              <p className="text-xs text-white/70">Đã giới thiệu</p>
            </div>
            <div>
              <p className="text-2xl font-black">{pendingCount}</p>
              <p className="text-xs text-white/70">Đang chờ</p>
            </div>
            <div>
              <p className="text-2xl font-black">{totalEarned.toLocaleString()}</p>
              <p className="text-xs text-white/70">Điểm đã nhận</p>
            </div>
          </div>
        </div>

        {/* Referral link */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6">
          <h2 className="font-semibold text-gray-900 mb-3">Link giới thiệu của bạn</h2>
          <div className="flex gap-2">
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-xs text-gray-600 font-mono truncate">
              {referralLink}
            </div>
            <button
              onClick={handleCopy}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                copied
                  ? 'bg-green-500 text-white'
                  : 'bg-[#EE4D2D] text-white hover:bg-[#d43e20]'
              }`}
            >
              {copied ? '✓ Đã sao chép' : 'Sao chép'}
            </button>
          </div>

          {/* Share buttons */}
          <div className="flex gap-2 mt-3">
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 bg-[#1877F2] text-white text-xs font-medium rounded-lg text-center hover:bg-[#1664d8] transition-colors"
            >
              Chia sẻ Facebook
            </a>
            <a
              href={`https://zalo.me/share/url?url=${encodeURIComponent(referralLink)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 bg-[#0068FF] text-white text-xs font-medium rounded-lg text-center hover:bg-[#0055cc] transition-colors"
            >
              Chia sẻ Zalo
            </a>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Cách hoạt động</h2>
          <div className="space-y-3">
            {[
              { step: '1', text: 'Sao chép link giới thiệu và chia sẻ với bạn bè' },
              { step: '2', text: 'Bạn bè đăng ký tài khoản qua link của bạn' },
              { step: '3', text: 'Bạn bè đặt đơn hàng đầu tiên thành công' },
              { step: '4', text: 'Cả hai nhận 500 điểm thưởng!' },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-[#EE4D2D] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {item.step}
                </span>
                <p className="text-sm text-gray-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* History */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-4">Lịch sử giới thiệu</h2>
          {referrals.length === 0 ? (
            <EmptyState icon="👥" title="Chưa có giới thiệu nào" message="Chia sẻ link để bắt đầu kiếm điểm" />
          ) : (
            <div className="space-y-3">
              {referrals.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{r.referredUser}</p>
                    <p className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString('vi-VN')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                    {r.status === 'REWARDED' && (
                      <span className="text-sm font-bold text-green-600">+{r.rewardPoints}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
