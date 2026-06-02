'use client';

import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { StatsCard } from '@/components/ui/StatsCard';
import { useAuthStore } from '@/lib/store/auth';
import { formatVND } from '@/lib/format';

interface Campaign {
  id:            string;
  name:          string;
  seller_id:     string;
  business_name: string;
  type:          'CPC' | 'CPM';
  status:        'ACTIVE' | 'PAUSED' | 'ENDED' | 'EXHAUSTED';
  daily_budget:  number;
  spent_today:   number;
  impressions:   number;
  clicks:        number;
  conversions:   number;
}

const STATUS_VARIANTS = {
  ACTIVE:    'success',
  PAUSED:    'warning',
  ENDED:     'default',
  EXHAUSTED: 'error',
} as const;

export default function AdminAdsPage() {
  const { accessToken }        = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]  = useState(true);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/admin/ads/campaigns', { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      setCampaigns(data.items ?? []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const totalSpend      = campaigns.reduce((s, c) => s + (c.spent_today ?? 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + (c.impressions ?? 0), 0);
  const totalClicks     = campaigns.reduce((s, c) => s + (c.clicks ?? 0), 0);
  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length;

  const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';

  const columns: Column<Campaign>[] = [
    {
      key: 'name',
      header: 'Chiến dịch',
      cell: (c) => (
        <div>
          <p className="text-sm font-medium text-gray-900">{c.name}</p>
          <p className="text-xs text-gray-400">{c.business_name}</p>
        </div>
      ),
    },
    { key: 'type',   header: 'Loại', cell: (c) => <Badge variant="info">{c.type}</Badge> },
    { key: 'status', header: 'Trạng thái', cell: (c) => <Badge variant={STATUS_VARIANTS[c.status]}>{c.status}</Badge>, sortable: true },
    {
      key: 'daily_budget',
      header: 'Ngân sách / ngày',
      cell: (c) => <span className="text-sm text-gray-700">{formatVND(c.daily_budget)}</span>,
      sortable: true,
    },
    {
      key: 'spent_today',
      header: 'Chi hôm nay',
      cell: (c) => {
        const pct = c.daily_budget > 0 ? (c.spent_today / c.daily_budget) * 100 : 0;
        return (
          <div>
            <span className="text-sm font-medium">{formatVND(c.spent_today)}</span>
            <div className="w-24 h-1.5 bg-gray-200 rounded-full mt-1">
              <div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-400' : 'bg-[#EE4D2D]'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
        );
      },
      sortable: true,
    },
    {
      key: 'impressions',
      header: 'Lượt hiển thị',
      cell: (c) => <span className="text-sm">{c.impressions?.toLocaleString()}</span>,
      sortable: true,
    },
    {
      key: 'clicks',
      header: 'Click',
      cell: (c) => (
        <div>
          <span className="text-sm">{c.clicks?.toLocaleString()}</span>
          <p className="text-xs text-gray-400">
            CTR: {c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0.00'}%
          </p>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'conversions',
      header: 'Chuyển đổi',
      cell: (c) => <span className="text-sm">{c.conversions?.toLocaleString()}</span>,
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Giám sát quảng cáo</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Chiến dịch đang chạy" value={String(activeCampaigns)} icon={<span>📢</span>} accent="bg-green-50" />
        <StatsCard label="Chi tiêu hôm nay"     value={formatVND(totalSpend)}    icon={<span>💸</span>} accent="bg-orange-50" />
        <StatsCard label="Lượt hiển thị"        value={totalImpressions.toLocaleString()} icon={<span>👁</span>} />
        <StatsCard label="CTR trung bình"        value={`${avgCtr}%`}             icon={<span>🖱</span>} accent="bg-blue-50" />
      </div>

      <DataTable columns={columns} data={campaigns} loading={loading} keyFn={(c) => c.id} emptyMessage="Không có chiến dịch quảng cáo" />
    </div>
  );
}
