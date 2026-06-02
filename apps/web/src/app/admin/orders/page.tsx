'use client';

import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { formatVND } from '@/lib/format';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface Order {
  id:           string;
  user_id:      string;
  seller_id:    string;
  status:       string;
  total_amount: number;
  created_at:   string;
}

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'DISPUTED', 'REFUNDED'];

export default function AdminOrdersPage() {
  const { accessToken }        = useAuthStore();
  const { success, error }     = useToast();
  const [orders, setOrders]    = useState<Order[]>([]);
  const [total, setTotal]      = useState(0);
  const [page, setPage]        = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading]  = useState(true);
  const [forceDialog, setForceDialog]   = useState<Order | null>(null);
  const [newStatus, setNewStatus]       = useState('');
  const [forceReason, setForceReason]   = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const res  = await fetch(`/api/admin/orders?${params}`, { headers });
      const data = await res.json();
      setOrders(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, accessToken]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleForceStatus = async () => {
    if (!forceDialog || !newStatus || !forceReason) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/orders/${forceDialog.id}/force-status`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason: forceReason }),
      });
      if (res.ok) {
        success('Đã cập nhật trạng thái đơn hàng');
        fetchOrders();
      } else {
        error('Không thể cập nhật');
      }
    } catch {
      error('Lỗi kết nối');
    } finally {
      setActionLoading(false);
      setForceDialog(null);
      setNewStatus('');
      setForceReason('');
    }
  };

  const columns: Column<Order>[] = [
    {
      key: 'id',
      header: 'Mã đơn',
      cell: (o) => <span className="text-xs font-mono text-gray-700">{o.id.slice(0, 8).toUpperCase()}</span>,
    },
    {
      key: 'total_amount',
      header: 'Giá trị',
      cell: (o) => <span className="text-sm font-semibold text-gray-900">{formatVND(o.total_amount)}</span>,
      sortable: true,
    },
    { key: 'status', header: 'Trạng thái', cell: (o) => <StatusBadge status={o.status} />, sortable: true },
    {
      key: 'created_at',
      header: 'Ngày đặt',
      cell: (o) => <span className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString('vi-VN')}</span>,
      sortable: true,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      cell: (o) => (
        <button
          onClick={() => { setForceDialog(o); setNewStatus(o.status); }}
          className="text-xs text-[#EE4D2D] hover:underline"
        >
          Đổi trạng thái
        </button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Quản lý đơn hàng</h1>
        <span className="text-sm text-gray-500">{total.toLocaleString()} đơn hàng</span>
      </div>

      {/* Filter */}
      <select
        value={statusFilter}
        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20"
      >
        <option value="">Tất cả trạng thái</option>
        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <DataTable columns={columns} data={orders} loading={loading} keyFn={(o) => o.id} />

      {total > 20 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">←</button>
          <span className="px-3 py-1.5 text-sm">Trang {page} / {Math.ceil(total / 20)}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 20)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">→</button>
        </div>
      )}

      <Modal open={!!forceDialog} onClose={() => setForceDialog(null)} title="Thay đổi trạng thái đơn hàng" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500 font-mono">{forceDialog?.id}</p>
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
          >
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea
            value={forceReason}
            onChange={(e) => setForceReason(e.target.value)}
            placeholder="Lý do thay đổi..."
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
          <div className="flex justify-end gap-3">
            <button onClick={() => setForceDialog(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Huỷ</button>
            <button
              onClick={handleForceStatus}
              disabled={actionLoading || !newStatus || !forceReason.trim()}
              className="px-4 py-2 text-sm bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] disabled:opacity-40"
            >
              {actionLoading ? 'Đang lưu...' : 'Xác nhận'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
