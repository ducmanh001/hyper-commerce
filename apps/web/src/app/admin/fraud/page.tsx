'use client';

import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/lib/store/auth';

interface FraudSignal {
  id:         string;
  user_id:    string;
  email:      string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  signals:    string[];
  created_at: string;
}

interface ChargebackWeek {
  week:             string;
  chargebacks:      number;
  total_payments:   number;
  chargeback_rate:  number;
}

const RISK_VARIANTS = {
  LOW:      'success',
  MEDIUM:   'warning',
  HIGH:     'error',
  CRITICAL: 'error',
} as const;

export default function AdminFraudPage() {
  const { accessToken }      = useAuthStore();
  const [signals, setSignals]   = useState<FraudSignal[]>([]);
  const [chargeback, setChargeback] = useState<ChargebackWeek[]>([]);
  const [loading, setLoading]   = useState(true);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch('/api/admin/fraud/signals', { headers }),
        fetch('/api/admin/fraud/chargeback-rate', { headers }),
      ]);
      const [sData, cData] = await Promise.all([sRes.json(), cRes.json()]);
      setSignals(sData.items ?? []);
      const cbArr = Array.isArray(cData) ? cData : (Array.isArray(cData?.data) ? cData.data : []);
      setChargeback(cbArr);
    } catch {
      setSignals([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const highRiskCount = signals.filter((s) => s.risk_level === 'HIGH' || s.risk_level === 'CRITICAL').length;

  const columns: Column<FraudSignal>[] = [
    {
      key: 'email',
      header: 'Người dùng',
      cell: (s) => (
        <div>
          <p className="text-sm font-medium text-gray-900">{s.email}</p>
          <p className="text-xs font-mono text-gray-400">{s.user_id.slice(0, 8)}</p>
        </div>
      ),
    },
    {
      key: 'risk_level',
      header: 'Mức độ rủi ro',
      cell: (s) => <Badge variant={RISK_VARIANTS[s.risk_level]}>{s.risk_level}</Badge>,
      sortable: true,
    },
    {
      key: 'signals',
      header: 'Tín hiệu',
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.signals?.slice(0, 3).map((sig, i) => (
            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{sig}</span>
          ))}
          {s.signals?.length > 3 && <span className="text-xs text-gray-400">+{s.signals.length - 3}</span>}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Phát hiện lúc',
      cell: (s) => <span className="text-xs text-gray-500">{new Date(s.created_at).toLocaleString('vi-VN')}</span>,
      sortable: true,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Phát hiện gian lận</h1>

      {/* Alert */}
      {highRiskCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="text-sm font-semibold text-red-700">{highRiskCount} tài khoản rủi ro cao cần xem xét</p>
            <p className="text-xs text-red-500">Kiểm tra ngay để ngăn chặn gian lận</p>
          </div>
        </div>
      )}

      {/* Chargeback chart */}
      {chargeback.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">Tỷ lệ chargeback theo tuần</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chargeback}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: unknown) => `${v}%`} />
              <Line type="monotone" dataKey="chargeback_rate" name="Chargeback rate" stroke="#EE4D2D" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 mt-2">Ngưỡng cảnh báo: 1.5% — Ngưỡng khẩn cấp: 3%</p>
        </div>
      )}

      {/* Signal table */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">Tín hiệu gian lận gần đây</h3>
        <DataTable columns={columns} data={signals} loading={loading} keyFn={(s) => s.id} emptyMessage="Không phát hiện tín hiệu bất thường" />
      </div>
    </div>
  );
}
