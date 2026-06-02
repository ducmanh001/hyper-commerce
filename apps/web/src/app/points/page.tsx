'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/auth';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';

interface PointTransaction {
  id:          string;
  type:        'EARNED' | 'SPENT' | 'EXPIRED' | 'ADJUSTED';
  points:      number;
  description: string;
  createdAt:   string;
  expiresAt?:  string;
}

interface Reward {
  id:          string;
  name:        string;
  description: string;
  pointsCost:  number;
  imageUrl?:   string;
  stock:       number;
  category:    string;
}

const TYPE_CONFIG: Record<PointTransaction['type'], { label: string; color: string; sign: string }> = {
  EARNED:   { label: 'Kiếm được', color: 'text-green-600', sign: '+' },
  SPENT:    { label: 'Đã dùng',   color: 'text-red-500',   sign: '-' },
  EXPIRED:  { label: 'Hết hạn',   color: 'text-gray-400',  sign: '-' },
  ADJUSTED: { label: 'Điều chỉnh', color: 'text-blue-500', sign: '±' },
};

export default function PointsPage() {
  const { user, accessToken }           = useAuthStore();
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [rewards, setRewards]           = useState<Reward[]>([]);
  const [loading, setLoading]           = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [txRes, rwRes] = await Promise.all([
        fetch('/api/points/transactions?limit=30', { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch('/api/points/rewards?limit=20'),
      ]);
      const [txData, rwData] = await Promise.all([txRes.json(), rwRes.json()]);
      setTransactions(txData.items ?? []);
      setRewards(rwData.items ?? []);
    } catch {
      setTransactions([]);
      setRewards([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const HistoryTab = (
    <div className="space-y-2">
      {loading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton circle className="w-8 h-8" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/3" rounded />
              <Skeleton className="h-3 w-1/3" rounded />
            </div>
            <Skeleton className="h-4 w-16" rounded />
          </div>
        ))
      ) : transactions.length === 0 ? (
        <EmptyState icon="🪙" title="Chưa có lịch sử điểm" message="Đặt hàng để tích điểm thưởng" />
      ) : (
        transactions.map((tx) => {
          const cfg = TYPE_CONFIG[tx.type];
          return (
            <div key={tx.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                tx.type === 'EARNED' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {tx.type === 'EARNED' ? '↑' : '↓'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{tx.description}</p>
                <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleDateString('vi-VN')}</p>
              </div>
              <span className={`font-bold text-sm ${cfg.color}`}>
                {cfg.sign}{Math.abs(tx.points).toLocaleString()}
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  const RewardsTab = (
    <div className="grid grid-cols-2 gap-3">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
            <Skeleton className="h-24 w-full" rounded />
            <Skeleton className="h-3 w-3/4" rounded />
            <Skeleton className="h-4 w-1/2" rounded />
          </div>
        ))
      ) : rewards.length === 0 ? (
        <div className="col-span-2">
          <EmptyState icon="🎁" title="Chưa có phần thưởng" message="Hãy quay lại sau" />
        </div>
      ) : (
        rewards.map((reward) => (
          <div key={reward.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="h-24 bg-gray-100 flex items-center justify-center text-4xl">
              🎁
            </div>
            <div className="p-3">
              <p className="text-xs font-medium text-gray-800 line-clamp-2">{reward.name}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-[#EE4D2D] font-bold">
                  🪙 {reward.pointsCost.toLocaleString()} điểm
                </span>
                <button
                  disabled={(user?.points ?? 0) < reward.pointsCost || reward.stock <= 0}
                  className="text-xs bg-[#EE4D2D] text-white px-2.5 py-1 rounded-lg hover:bg-[#d43e20] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Đổi
                </button>
              </div>
              {reward.stock <= 5 && reward.stock > 0 && (
                <p className="text-xs text-orange-500 mt-1">Còn {reward.stock}</p>
              )}
              {reward.stock <= 0 && (
                <p className="text-xs text-gray-400 mt-1">Hết hàng</p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Points balance */}
        <div className="bg-gradient-to-br from-[#EE4D2D] to-orange-400 rounded-2xl p-6 text-white text-center mb-6">
          <p className="text-sm text-white/70 font-medium">Số điểm hiện có</p>
          <p className="text-5xl font-black mt-1">{(user?.points ?? 0).toLocaleString()}</p>
          <p className="text-sm text-white/70 mt-1">điểm thưởng</p>

          <div className="flex justify-center gap-8 mt-5 pt-4 border-t border-white/20">
            <div className="text-center">
              <p className="text-sm font-bold">10.000đ</p>
              <p className="text-xs text-white/70">mỗi 100 điểm</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold">1 điểm</p>
              <p className="text-xs text-white/70">mỗi 10.000đ mua hàng</p>
            </div>
          </div>
        </div>

        <Tabs
          tabs={[
            { key: 'history', label: 'Lịch sử', content: HistoryTab },
            { key: 'rewards', label: 'Đổi thưởng', content: RewardsTab },
          ]}
          defaultTab="history"
        />
      </div>
    </div>
  );
}
