'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, FunnelChart, Funnel, Cell } from 'recharts';
import { TrendingUp, TrendingDown, ShoppingBag, DollarSign, Users, BarChart2 } from 'lucide-react';
import { formatVND, formatVNDCompact } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';

interface AnalyticsData {
  revenue:     Array<{ date: string; revenue: number; orders: number }>;
  topProducts: Array<{ productId: string; name: string; views: number; orders: number; revenue: number; convRate: number }>;
  funnel:      Array<{ step: string; users: number }>;
  summary: { totalRevenue: number; revenueGrowth: number; totalOrders: number; ordersGrowth: number; avgOrderValue: number; conversionRate: number; cancelRate: number; returnRate: number };
}

function StatCard({ label, value, growth, icon, accent }: { label: string; value: string; growth?: number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {growth !== undefined && (
            <p className={`text-xs mt-1 flex items-center gap-1 ${growth >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {growth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(growth)}% so với tháng trước
            </p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${accent}`}>{icon}</div>
      </div>
    </div>
  );
}

const FUNNEL_COLORS = ['#EE4D2D', '#FF6B35', '#FFCA3A', '#4CAF50'];

export default function SellerAnalyticsPage() {
  const { accessToken } = useAuthStore();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'7d' | '30d'>('30d');

  useEffect(() => {
    fetch('/api/seller/analytics', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accessToken]);

  const displayRevenue = data?.revenue.slice(range === '7d' ? -7 : undefined) ?? [];

  if (loading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 border-2 border-[#EE4D2D] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phân tích hiệu suất</h1>
          <p className="text-sm text-gray-500">Dữ liệu realtime từ Analytics Service</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d'] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${range === r ? 'text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}
              style={range === r ? { background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' } : {}}>
              {r === '7d' ? '7 ngày' : '30 ngày'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng doanh thu" value={formatVNDCompact(data?.summary.totalRevenue ?? 0)} growth={data?.summary.revenueGrowth} icon={<DollarSign className="w-5 h-5 text-green-600" />} accent="bg-green-50" />
        <StatCard label="Đơn hàng" value={(data?.summary.totalOrders ?? 0).toLocaleString()} growth={data?.summary.ordersGrowth} icon={<ShoppingBag className="w-5 h-5 text-blue-600" />} accent="bg-blue-50" />
        <StatCard label="AOV" value={formatVND(data?.summary.avgOrderValue ?? 0)} icon={<BarChart2 className="w-5 h-5 text-purple-600" />} accent="bg-purple-50" />
        <StatCard label="Tỷ lệ chuyển đổi" value={`${data?.summary.conversionRate ?? 0}%`} icon={<TrendingUp className="w-5 h-5 text-orange-600" />} accent="bg-orange-50" />
      </div>

      {/* Revenue chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">Doanh thu theo ngày</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={displayRevenue}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
            <Tooltip formatter={(v: unknown) => [formatVND(Number(v)), 'Doanh thu']} />
            <Line type="monotone" dataKey="revenue" stroke="#EE4D2D" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funnel */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">Phễu chuyển đổi</h3>
          <div className="space-y-3">
            {(data?.funnel ?? []).map((step, i) => {
              const pct = i === 0 ? 100 : Math.round((step.users / (data?.funnel[0].users ?? 1)) * 100);
              return (
                <div key={step.step}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{step.step}</span>
                    <span className="font-semibold">{step.users.toLocaleString()} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: FUNNEL_COLORS[i] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top products */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">Top sản phẩm</h3>
          <div className="space-y-3">
            {(data?.topProducts ?? []).map((p, i) => (
              <div key={p.productId} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.orders} đơn · {p.convRate}% conv</p>
                </div>
                <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{formatVNDCompact(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Orders bar chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">Đơn hàng theo ngày</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={displayRevenue}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="orders" name="Đơn hàng" fill="#EE4D2D" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
