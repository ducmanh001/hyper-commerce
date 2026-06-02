'use client';

import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/ui/DataTable';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface Seller {
  id:          string;
  shopName:    string;
  email:       string;
  status:      string;
  tier?:       string;
  createdAt:   string;
}

export default function AdminSellersPage() {
  const { accessToken }          = useAuthStore();
  const { success, error }       = useToast();
  const [sellers, setSellers]    = useState<Seller[]>([]);
  const [total, setTotal]        = useState(0);
  const [page, setPage]          = useState(1);
  const [search, setSearch]      = useState('');
  const [loading, setLoading]    = useState(true);
  const [verifyTarget, setVerifyTarget]   = useState<Seller | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<Seller | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const debouncedSearch = useDebounce(search, 400);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchSellers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      const res  = await fetch(`/api/admin/sellers?${params}`, { headers });
      const data = await res.json();
      setSellers(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setSellers([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, accessToken]);

  useEffect(() => { fetchSellers(); }, [fetchSellers]);

  const handleVerify = async () => {
    if (!verifyTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/sellers/${verifyTarget.id}/verify`, { method: 'PATCH', headers });
      if (res.ok) { success('Đã xác minh seller'); fetchSellers(); }
      else error('Không thể thực hiện');
    } catch { error('Lỗi kết nối'); }
    finally { setActionLoading(false); setVerifyTarget(null); }
  };

  const handleSuspend = async () => {
    if (!suspendTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/sellers/${suspendTarget.id}/suspend`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Suspended by admin' }),
      });
      if (res.ok) { success('Đã tạm ngưng seller'); fetchSellers(); }
      else error('Không thể thực hiện');
    } catch { error('Lỗi kết nối'); }
    finally { setActionLoading(false); setSuspendTarget(null); }
  };

  const TIER_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'orange'> = {
    FREE: 'default', BASIC: 'info' as 'default', PROFESSIONAL: 'warning', ENTERPRISE: 'success',
  };

  const columns: Column<Seller>[] = [
    {
      key: 'shopName',
      header: 'Shop',
      cell: (s) => (
        <div>
          <p className="text-sm font-medium text-gray-900">{s.shopName}</p>
          <p className="text-xs text-gray-400">{s.email}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', cell: (s) => <StatusBadge status={s.status} /> },
    {
      key: 'tier',
      header: 'Gói',
      cell: (s) => <Badge variant={s.tier ? (TIER_VARIANT[s.tier] ?? 'default') : 'default'}>{s.tier ?? '-'}</Badge>,
    },
    {
      key: 'created_at',
      header: 'Ngày đăng ký',
      cell: (s) => <span className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString('vi-VN')}</span>,
      sortable: true,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      cell: (s) => (
        <div className="flex gap-2">
          {s.status === 'PENDING' && (
            <button onClick={() => setVerifyTarget(s)} className="text-xs text-green-600 hover:underline">Xác minh</button>
          )}
          {s.status === 'ACTIVE' && (
            <button onClick={() => setSuspendTarget(s)} className="text-xs text-red-500 hover:underline">Tạm ngưng</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Quản lý người bán</h1>
        <span className="text-sm text-gray-500">{total.toLocaleString()} người bán</span>
      </div>

      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Tìm kiếm theo tên shop hoặc email..."
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20"
      />

      <DataTable columns={columns} data={sellers} loading={loading} keyFn={(s) => s.id} />

      {total > 20 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">←</button>
          <span className="px-3 py-1.5 text-sm">Trang {page}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 20)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">→</button>
        </div>
      )}

      <ConfirmDialog open={!!verifyTarget} title="Xác minh người bán"
        message={`Xác minh shop "${verifyTarget?.shopName}"?`}
        confirmText="Xác minh" loading={actionLoading}
        onConfirm={handleVerify} onCancel={() => setVerifyTarget(null)} />

      <ConfirmDialog open={!!suspendTarget} title="Tạm ngưng người bán" danger
        message={`Tạm ngưng shop "${suspendTarget?.shopName}"?`}
        confirmText="Tạm ngưng" loading={actionLoading}
        onConfirm={handleSuspend} onCancel={() => setSuspendTarget(null)} />
    </div>
  );
}
