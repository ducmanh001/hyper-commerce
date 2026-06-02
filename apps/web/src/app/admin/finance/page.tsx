'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { StatsCard } from '@/components/ui/StatsCard';
import { DataTable, Column } from '@/components/ui/DataTable';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { formatVND } from '@/lib/format';

interface Payout {
  id:          string;
  sellerName:  string;
  sellerId:    string;
  amount:      number;
  status:      string;
  requestedAt: string;
  bankAccount: string;
}

interface FinanceRevenue {
  weekly:      Array<{ date: string; revenue: number; orders: number }>;
  pieData:     Array<{ name: string; value: number }>;
  totalRevenue: number;
  growth:      number;
}

const PIE_COLORS = ['#EE4D2D', '#3B82F6', '#10B981'];

export default function AdminFinancePage() {
  const { accessToken }            = useAuthStore();
  const { success, error }         = useToast();
  const [summary, setSummary]      = useState<FinanceRevenue | null>(null);
  const [payouts, setPayouts]      = useState<Payout[]>([]);
  const [loading, setLoading]      = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, payRes] = await Promise.all([
        fetch('/api/admin/finance/revenue', { headers }),
        fetch('/api/admin/finance/payouts', { headers }),
      ]);
      const [sumData, payData] = await Promise.all([sumRes.json(), payRes.json()]);
      setSummary(sumData);
      setPayouts(payData.items ?? []);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePayout = async (id: string) => {
    setProcessing(id);
    try {
      const res = await fetch(`/api/admin/finance/payouts/${id}/process`, { method: 'POST', headers });
      if (res.ok) { success('Đã gửi thanh toán'); fetchData(); }
      else error('Không thể xử lý thanh toán');
    } catch { error('Lỗi kết nối'); }
    finally { setProcessing(null); }
  };

  const pieData = summary?.pieData ?? [];

  const columns: Column<Payout>[] = [
    { key: 'id',          header: 'ID',          cell: (p) => <span className="font-mono text-xs">{p.id.slice(0, 8)}</span> },
    { key: 'sellerName',  header: 'Shop',        cell: (p) => <span className="text-sm">{p.sellerName}</span> },
    { key: 'amount',        header: 'Số tiền',       cell: (p) => <span className="font-semibold text-gray-900">{formatVND(p.amount)}</span>, sortable: true },
    { key: 'status',        header: 'Trạng thái',    cell: (p) => <span className={`text-xs font-medium ${p.status === 'PENDING' ? 'text-yellow-600' : p.status === 'PROCESSING' ? 'text-blue-600' : 'text-green-600'}`}>{p.status}</span> },
    {
      key: 'requestedAt',
      header: 'Ngày tạo',
      cell: (p) => <span className="text-xs text-gray-500">{new Date(p.requestedAt).toLocaleDateString('vi-VN')}</span>,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      cell: (p) => p.status === 'PENDING' ? (
        <button
          onClick={() => handlePayout(p.id)}
          disabled={processing === p.id}
          className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 transition-colors disabled:opacity-40"
        >
          {processing === p.id ? 'Đang xử lý...' : 'Xử lý'}
        </button>
      ) : null,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Tài chính</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Tổng doanh thu"    value={summary ? formatVND(summary.totalRevenue) : '...'} icon={<span>💰</span>} accent="bg-green-50" change={summary?.growth} />
        <StatsCard label="Hoa hồng"          value={summary ? formatVND(summary.pieData[0]?.value ?? 0) : '...'} icon={<span>📊</span>} />
        <StatsCard label="Doanh thu quảng cáo" value={summary ? formatVND(summary.pieData[1]?.value ?? 0) : '...'} icon={<span>📢</span>} accent="bg-blue-50" />
        <StatsCard label="Subscription"      value={summary ? formatVND(summary.pieData[2]?.value ?? 0) : '...'} icon={<span>📋</span>} accent="bg-purple-50" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">Phân bổ doanh thu</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: unknown) => formatVND(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">So sánh nguồn doanh thu</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={pieData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
              <Tooltip formatter={(v: unknown) => formatVND(Number(v))} />
              <Bar dataKey="value" name="Doanh thu" fill="#EE4D2D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Payout queue */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">Hàng chờ thanh toán</h3>
        <DataTable columns={columns} data={payouts} loading={loading} keyFn={(p) => p.id} emptyMessage="Không có giao dịch chờ xử lý" />
      </div>
    </div>
  );
}
