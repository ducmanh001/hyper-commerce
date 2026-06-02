'use client';

import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useAuthStore } from '@/lib/store/auth';
import { formatVND } from '@/lib/format';

interface ServiceHealth {
  name:    string;
  status:  'up' | 'down' | 'unknown' | 'healthy' | 'error';
  latency: number | null;
}

interface DailyRevenue {
  date:          string;
  commissions:   number;
  adRevenue:     number;
  subscriptions: number;
}

// Stub data — replaced by real API in production
const STUB_REVENUE: DailyRevenue[] = Array.from({ length: 14 }, (_, i) => ({
  date:          new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
  commissions:   Math.floor(Math.random() * 50_000_000) + 10_000_000,
  adRevenue:     Math.floor(Math.random() * 10_000_000),
  subscriptions: Math.floor(Math.random() * 5_000_000),
}));

export default function AdminDashboard() {
  const { accessToken }                       = useAuthStore();
  const [services, setServices]               = useState<ServiceHealth[]>([]);
  const [statsLoading, setStatsLoading]       = useState(true);
  const [stats, setStats]                     = useState({
    totalUsers:    0,
    activeOrders:  0,
    todayRevenue:  0,
    pendingDisputes: 0,
  });

  useEffect(() => {
    const headers = { Authorization: `Bearer ${accessToken}` };

    Promise.all([
      fetch('/api/admin/system/service-health', { headers }).then((r) => r.json()).catch(() => ({ services: [] })),
      fetch('/api/admin/stats/overview', { headers }).then((r) => r.json()).catch(() => null),
    ])
      .then(([health, overview]) => {
        // API returns { services: [...] }
        setServices(Array.isArray(health) ? health : (health?.services ?? []));
        if (overview) {
          setStats({
            totalUsers:      overview.users?.total       ?? overview.totalUsers       ?? 0,
            activeOrders:    overview.orders?.today      ?? overview.activeOrders     ?? 0,
            todayRevenue:    overview.revenue?.today     ?? overview.todayRevenue     ?? 0,
            pendingDisputes: overview.pendingDisputes    ?? 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [accessToken]);

  const isUp   = (s: ServiceHealth) => s.status === 'up' || s.status === 'healthy';
  const isDown = (s: ServiceHealth) => s.status === 'down' || s.status === 'error';
  const upCount   = services.filter(isUp).length;
  const downCount = services.filter(isDown).length;

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Xin chào, {useAuthStore.getState().user?.fullName ?? 'Admin'} 👋</p>
        </div>
        <div className="text-sm text-gray-500 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-sm font-medium">
          {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Người dùng', value: statsLoading ? '…' : stats.totalUsers.toLocaleString('vi-VN'), icon: '👥', change: 2.4, from: '#6366F1', to: '#818CF8' },
          { label: 'Đơn đang xử lý', value: statsLoading ? '…' : stats.activeOrders.toLocaleString('vi-VN'), icon: '📦', change: -1.2, from: '#3B82F6', to: '#60A5FA' },
          { label: 'Doanh thu hôm nay', value: statsLoading ? '…' : formatVND(stats.todayRevenue), icon: '💰', change: 8.3, from: '#10B981', to: '#34D399' },
          { label: 'Tranh chấp chờ', value: statsLoading ? '…' : stats.pendingDisputes.toLocaleString('vi-VN'), icon: '⚖️', change: 0, from: '#EE4D2D', to: '#FF6B35' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 relative overflow-hidden">
            {/* gradient accent strip */}
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${s.from}, ${s.to})` }} />
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shadow"
                style={{ background: `linear-gradient(135deg, ${s.from}22, ${s.to}44)` }}
              >
                {s.icon}
              </div>
              {s.change !== 0 && (
                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${s.change > 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                  {s.change > 0 ? '+' : ''}{s.change}%
                </span>
              )}
            </div>
            <p className="text-2xl font-black text-gray-900 mb-0.5 truncate">{s.value}</p>
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-black text-gray-900">Doanh thu 14 ngày qua</h2>
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg border border-gray-200">Triệu VNĐ</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={STUB_REVENUE}>
            <defs>
              <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#EE4D2D" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#EE4D2D" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="adGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
              formatter={(v: unknown) => formatVND(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
            <Area type="monotone" dataKey="commissions"   name="Hoa hồng"    stroke="#EE4D2D" fill="url(#commGrad)" strokeWidth={2.5} dot={false} />
            <Area type="monotone" dataKey="adRevenue"     name="Quảng cáo"   stroke="#3B82F6" fill="url(#adGrad)"   strokeWidth={2}   dot={false} />
            <Area type="monotone" dataKey="subscriptions" name="Subscription" stroke="#10B981" fill="none"          strokeWidth={2}   dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Service health */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-gray-900">Trạng thái dịch vụ</h2>
          <div className="flex gap-3 text-xs">
            <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">{upCount} hoạt động</span>
            {downCount > 0 && <span className="font-bold text-red-500 bg-red-50 px-2 py-1 rounded-lg">{downCount} lỗi</span>}
          </div>
        </div>

        {services.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl skeleton" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {services.map((svc) => (
              <div
                key={svc.name}
                className="rounded-xl p-3 flex items-center gap-2.5 border transition-colors"
                style={{
                  borderColor: isUp(svc) ? '#D1FAE5' : isDown(svc) ? '#FEE2E2' : '#F1F5F9',
                  background:  isUp(svc) ? '#F0FDF4'  : isDown(svc) ? '#FFF1F2'  : '#F8FAFC',
                }}
              >
                <span
                  className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${
                    isUp(svc) ? 'bg-emerald-500' : isDown(svc) ? 'bg-red-500 animate-pulse' : 'bg-gray-300'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{svc.name}</p>
                  {svc.latency !== null && (
                    <p className="text-[10px] text-gray-400">{svc.latency}ms</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
