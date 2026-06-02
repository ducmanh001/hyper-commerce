'use client';

import { useState, useEffect } from 'react';
import { CreditCard, Clock, CheckCircle, AlertCircle, DollarSign } from 'lucide-react';
import { formatVND } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';

interface Payment {
  id: string; orderId: string; buyerName: string;
  amount: number; commission: number; netAmount: number;
  status: string; payoutDate: string | null; createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  REFUNDED:  'bg-red-100 text-red-700',
  HELD:      'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ thanh toán', COMPLETED: 'Đã thanh toán', REFUNDED: 'Đã hoàn tiền', HELD: 'Đang giữ',
};

const FILTERS = ['ALL', 'PENDING', 'COMPLETED', 'REFUNDED', 'HELD'];

export default function SellerPaymentsPage() {
  const { accessToken } = useAuthStore();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('ALL');

  useEffect(() => {
    const params = new URLSearchParams({ status: filter });
    fetch(`/api/seller/payments?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((d) => { setPayments(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accessToken, filter]);

  const totalNet     = payments.filter((p) => p.status === 'COMPLETED').reduce((s, p) => s + p.netAmount, 0);
  const totalPending = payments.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.netAmount, 0);
  const totalRefund  = payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.amount, 0);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quản lý thanh toán</h1>
        <p className="text-sm text-gray-500">Theo dõi doanh thu và lịch sử thanh toán</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-green-50"><CheckCircle className="w-5 h-5 text-green-600" /></div>
            <p className="text-sm text-gray-500">Đã nhận</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatVND(totalNet)}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-yellow-50"><Clock className="w-5 h-5 text-yellow-600" /></div>
            <p className="text-sm text-gray-500">Chờ thanh toán</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatVND(totalPending)}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-red-50"><AlertCircle className="w-5 h-5 text-red-500" /></div>
            <p className="text-sm text-gray-500">Đã hoàn tiền</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatVND(totalRefund)}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 bg-white rounded-xl p-1 shadow-sm border border-gray-100 w-fit">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            style={filter === f ? { background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' } : {}}>
            {f === 'ALL' ? 'Tất cả' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Đơn hàng</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Người mua</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Doanh thu</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Hoa hồng (3%)</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Thực nhận</th>
              <th className="text-center px-4 py-3 text-gray-500 font-medium">Trạng thái</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Ngày thanh toán</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-50">
                {Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}
              </tr>
            )) : payments.map((p) => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">#{p.orderId.slice(-8)}</td>
                <td className="px-4 py-3 text-gray-700">{p.buyerName}</td>
                <td className="px-4 py-3 text-right font-medium">{formatVND(p.amount)}</td>
                <td className="px-4 py-3 text-right text-red-500">-{formatVND(p.commission)}</td>
                <td className="px-4 py-3 text-right font-bold text-green-700">{formatVND(p.netAmount)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-400">
                  {p.payoutDate ? new Date(p.payoutDate).toLocaleDateString('vi-VN') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && payments.length === 0 && (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <DollarSign className="w-12 h-12 mb-3 opacity-30" />
            <p>Không có dữ liệu thanh toán</p>
          </div>
        )}
      </div>
    </div>
  );
}
