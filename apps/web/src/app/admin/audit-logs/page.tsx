'use client';

import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface AuditLog {
  id:          string;
  actor_id:    string;
  actor_email: string;
  actor_role:  string;
  action:      string;
  resource:    string;
  resource_id?: string;
  success:     boolean;
  ip_address:  string;
  created_at:  string;
  changes?:    Record<string, unknown>;
}

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'BAN', 'UNBAN', 'APPROVE', 'REJECT', 'IMPERSONATE', 'EXPORT', 'REFUND', 'PAYOUT'];
const RESOURCES = ['User', 'Order', 'Product', 'Seller', 'Dispute', 'Campaign', 'FeatureFlag', 'Role', 'Payment', 'Payout'];

export default function AdminAuditLogsPage() {
  const { accessToken }      = useAuthStore();
  const [logs, setLogs]      = useState<AuditLog[]>([]);
  const [total, setTotal]    = useState(0);
  const [page, setPage]      = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail]  = useState<AuditLog | null>(null);

  const [filters, setFilters] = useState({
    actorId:  '',
    resource: '',
    action:   '',
    from:     '',
    to:       '',
  });

  const debouncedActor = useDebounce(filters.actorId, 500);
  const headers        = { Authorization: `Bearer ${accessToken}` };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (debouncedActor)   params.set('actorId',  debouncedActor);
      if (filters.resource) params.set('resource', filters.resource);
      if (filters.action)   params.set('action',   filters.action);
      if (filters.from)     params.set('from',     filters.from);
      if (filters.to)       params.set('to',       filters.to);
      const res  = await fetch(`/api/admin/audit-logs?${params}`, { headers });
      const data = await res.json();
      setLogs(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedActor, filters.resource, filters.action, filters.from, filters.to, accessToken]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const columns: Column<AuditLog>[] = [
    {
      key: 'actor_email',
      header: 'Người thực hiện',
      cell: (l) => (
        <div>
          <p className="text-sm font-medium text-gray-900">{l.actor_email}</p>
          <p className="text-xs text-gray-400">{l.actor_role}</p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Hành động',
      cell: (l) => (
        <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
          {l.action}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'resource',
      header: 'Đối tượng',
      cell: (l) => (
        <div>
          <span className="text-xs text-gray-700">{l.resource}</span>
          {l.resource_id && <p className="text-xs text-gray-400 font-mono">{l.resource_id.slice(0, 8)}</p>}
        </div>
      ),
    },
    {
      key: 'success',
      header: 'Kết quả',
      cell: (l) => (
        <span className={`text-xs font-medium ${l.success ? 'text-green-600' : 'text-red-500'}`}>
          {l.success ? '✓ Thành công' : '✕ Thất bại'}
        </span>
      ),
    },
    {
      key: 'ip_address',
      header: 'IP',
      cell: (l) => <span className="text-xs font-mono text-gray-500">{l.ip_address}</span>,
    },
    {
      key: 'created_at',
      header: 'Thời gian',
      cell: (l) => <span className="text-xs text-gray-500">{new Date(l.created_at).toLocaleString('vi-VN')}</span>,
      sortable: true,
    },
    {
      key: 'detail',
      header: '',
      cell: (l) => l.changes ? (
        <button onClick={() => setDetail(l)} className="text-xs text-[#EE4D2D] hover:underline">Chi tiết</button>
      ) : null,
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Nhật ký hệ thống</h1>
        <span className="text-sm text-gray-500">{total.toLocaleString()} bản ghi</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={filters.actorId}
          onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))}
          placeholder="Actor ID..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 w-40"
        />
        <select
          value={filters.resource}
          onChange={(e) => setFilters((f) => ({ ...f, resource: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">Tất cả đối tượng</option>
          {RESOURCES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">Tất cả hành động</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
        />
      </div>

      <DataTable columns={columns} data={logs} loading={loading} keyFn={(l) => l.id} />

      {total > 50 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">←</button>
          <span className="px-3 py-1.5 text-sm">Trang {page}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 50)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">→</button>
        </div>
      )}

      {/* Changes detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Chi tiết thay đổi" size="lg">
        <div className="p-5">
          <pre className="text-xs bg-gray-50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(detail?.changes, null, 2)}
          </pre>
        </div>
      </Modal>
    </div>
  );
}
