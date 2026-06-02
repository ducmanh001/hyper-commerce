'use client';

import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { StatsCard } from '@/components/ui/StatsCard';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { formatVND } from '@/lib/format';

interface Dispute {
  id:       string;
  orderId:  string;
  reason:   string;
  status:   string;
  createdAt: string;
  amount?:  number;
}

interface DisputeStats {
  open:        number;
  inReview:    number;
  resolved:    number;
  total:       number;
  totalAmount: number;
}

export default function AdminDisputesPage() {
  const { accessToken }           = useAuthStore();
  const { success, error }        = useToast();
  const [disputes, setDisputes]   = useState<Dispute[]>([]);
  const [stats, setStats]         = useState<DisputeStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [resolveTarget, setResolveTarget] = useState<Dispute | null>(null);
  const [outcome, setOutcome]     = useState('REFUND');
  const [refundAmount, setRefundAmount] = useState('');
  const [resolution, setResolution]     = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes] = await Promise.all([
        fetch('/api/admin/disputes/queue', { headers }),
        fetch('/api/admin/disputes/stats', { headers }),
      ]);
      const [dData, sData] = await Promise.all([dRes.json(), sRes.json()]);
      setDisputes(dData.items ?? []);
      setStats(sData);
    } catch {
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleResolve = async () => {
    if (!resolveTarget || !resolution) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/disputes/${resolveTarget.id}/resolve`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome,
          refundAmount: refundAmount ? Number(refundAmount) : 0,
          resolution,
        }),
      });
      if (res.ok) { success('Đã giải quyết tranh chấp'); fetchData(); }
      else error('Không thể thực hiện');
    } catch { error('Lỗi kết nối'); }
    finally {
      setActionLoading(false);
      setResolveTarget(null);
      setResolution('');
      setRefundAmount('');
    }
  };

  const columns: Column<Dispute>[] = [
    { key: 'id',       header: 'ID',        cell: (d) => <span className="font-mono text-xs">{d.id.slice(0, 8)}</span> },
    { key: 'orderId',  header: 'Đơn hàng',  cell: (d) => <span className="font-mono text-xs">{d.orderId.slice(0, 8)}</span> },
    { key: 'reason',   header: 'Lý do',     cell: (d) => <span className="text-sm line-clamp-1">{d.reason}</span> },
    { key: 'status',   header: 'Trạng thái', cell: (d) => <StatusBadge status={d.status} /> },
    {
      key: 'createdAt',
      header: 'Ngày tạo',
      cell: (d) => <span className="text-xs text-gray-500">{new Date(d.createdAt).toLocaleDateString('vi-VN')}</span>,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      cell: (d) => d.status === 'OPEN' ? (
        <button onClick={() => setResolveTarget(d)} className="text-xs text-[#EE4D2D] hover:underline">Giải quyết</button>
      ) : null,
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Quản lý tranh chấp</h1>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard label="Đang mở"       value={String(stats.open)}           icon={<span>⚖️</span>} accent="bg-red-50" />
          <StatsCard label="Đang xem xét"  value={String(stats.inReview)}       icon={<span>🔍</span>} accent="bg-yellow-50" />
          <StatsCard label="Đã giải quyết" value={String(stats.resolved)}       icon={<span>✅</span>} accent="bg-green-50" />
          <StatsCard label="Tổng tranh chấp" value={formatVND(stats.totalAmount)} icon={<span>💸</span>} accent="bg-orange-50" />
        </div>
      )}

      <DataTable columns={columns} data={disputes} loading={loading} keyFn={(d) => d.id} />

      <Modal open={!!resolveTarget} onClose={() => setResolveTarget(null)} title="Giải quyết tranh chấp" size="md">
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kết quả</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
            >
              <option value="REFUND">Hoàn tiền</option>
              <option value="PARTIAL_REFUND">Hoàn tiền một phần</option>
              <option value="NO_REFUND">Không hoàn tiền</option>
              <option value="REPLACEMENT">Đổi hàng</option>
            </select>
          </div>
          {(outcome === 'REFUND' || outcome === 'PARTIAL_REFUND') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Số tiền hoàn (VND)</label>
              <input
                type="number"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                placeholder="0"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú giải quyết</label>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={4}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              placeholder="Mô tả lý do và cách giải quyết..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setResolveTarget(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Huỷ</button>
            <button
              onClick={handleResolve}
              disabled={actionLoading || !resolution.trim()}
              className="px-4 py-2 text-sm bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] disabled:opacity-40"
            >
              {actionLoading ? 'Đang xử lý...' : 'Xác nhận'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
