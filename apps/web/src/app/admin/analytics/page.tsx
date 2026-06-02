'use client';

import { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, ShoppingBag, DollarSign, Users } from 'lucide-react';
import { formatVND, formatVNDCompact } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';

interface AdminGMV {
  daily:              Array<{ date: string; gmv: number; orders: number; aov: number }>;
  categoryBreakdown:  Array<{ category: string; gmv: number; orders: number; share: number }>;
  orderFunnel:        Array<{ step: string; count: number; pct: number }>;
  hourlyThroughput:   Array<{ hour: string; orders: number }>;
  summary:            { totalGMV: number; gmvGrowth: number; totalOrders: number; ordersGrowth: number; aov: number; cancelRate: number };
}

const PIE_COLORS = ['#EE4D2D','#FF6B35','#FFCA3A','#4CAF50','#2196F3','#9C27B0','#FF9800','#607D8B'];
const FUNNEL_COLORS = ['#EE4D2D','#FF6B35','#FFCA3A','#4CAF50','#2196F3','#9C27B0'];

function StatCard({ label, value, growth, icon, accent }: { label: string; value: string; growth?: number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {growth !== undefined && (
            <p className={`text-xs mt-1 ${growth >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% so với tháng trước
            </p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${accent}`}>{icon}</div>
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const { accessToken } = useAuthStore();
  const [data, setData]   = useState<AdminGMV | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'7d' | '30d'>('30d');

  useEffect(() => {
    fetch('/api/admin/analytics', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accessToken]);

  const displayDaily = data?.daily.slice(range === '7d' ? -7 : undefined) ?? [];

  if (loading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 border-2 border-[#EE4D2D] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & GMV</h1>
          <p className="text-sm text-gray-500">Gross Merchandise Value & hiệu suất toàn sàn</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d'] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${range === r ? 'text-white' : 'bg-white border text-gray-600'}`}
              style={range === r ? { background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' } : {}}>
              {r === '7d' ? '7 ngày' : '30 ngày'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng GMV" value={formatVNDCompact(data?.summary.totalGMV ?? 0)} growth={data?.summary.gmvGrowth} icon={<DollarSign className="w-5 h-5 text-green-600" />} accent="bg-green-50" />
        <StatCard label="Tổng đơn hàng" value={(data?.summary.totalOrders ?? 0).toLocaleString()} growth={data?.summary.ordersGrowth} icon={<ShoppingBag className="w-5 h-5 text-blue-600" />} accent="bg-blue-50" />
        <StatCard label="AOV" value={formatVND(data?.summary.aov ?? 0)} icon={<TrendingUp className="w-5 h-5 text-purple-600" />} accent="bg-purple-50" />
        <StatCard label="Tỷ lệ huỷ" value={`${data?.summary.cancelRate ?? 0}%`} icon={<Users className="w-5 h-5 text-orange-600" />} accent="bg-orange-50" />
      </div>

      {/* GMV chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">GMV theo ngày</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={displayDaily}>
            <defs>
              <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#EE4D2D" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#EE4D2D" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1e9).toFixed(1)}B`} />
            <Tooltip formatter={(v: unknown) => formatVND(Number(v))} />
            <Area type="monotone" dataKey="gmv" stroke="#EE4D2D" strokeWidth={2} fill="url(#gmvGrad)" name="GMV" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Category breakdown */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">GMV theo danh mục</h3>
          <div className="flex gap-4">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={data?.categoryBreakdown ?? []} dataKey="gmv" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                  {(data?.categoryBreakdown ?? []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: unknown) => formatVNDCompact(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5 overflow-hidden">
              {(data?.categoryBreakdown ?? []).map((cat, i) => (
                <div key={cat.category} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="flex-1 truncate text-gray-600">{cat.category}</span>
                  <span className="font-semibold text-gray-900">{cat.share}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Order funnel */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">Phễu đơn hàng</h3>
          <div className="space-y-2.5">
            {(data?.orderFunnel ?? []).map((step, i) => (
              <div key={step.step}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">{step.step}</span>
                  <span className="font-semibold">{(step.count / 1000).toFixed(0)}K <span className="text-gray-400 font-normal">({step.pct}%)</span></span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-full rounded-full" style={{ width: `${step.pct}%`, background: FUNNEL_COLORS[i] }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hourly throughput */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">Throughput đơn hàng (48h gần nhất)</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data?.hourlyThroughput ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={5} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="orders" name="Đơn hàng" fill="#EE4D2D" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
