'use client';

import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface User {
  id:         string;
  email:      string;
  fullName:   string;
  role:       string;
  status:     string;
  createdAt:  string;
  totalOrders: number;
}

const ROLES = ['BUYER', 'SELLER', 'OPS', 'FINANCE', 'TRUST_SAFETY', 'ADMIN', 'SUPER_ADMIN'];

export default function AdminUsersPage() {
  const { accessToken }        = useAuthStore();
  const { success, error }     = useToast();
  const [users, setUsers]      = useState<User[]>([]);
  const [total, setTotal]      = useState(0);
  const [page, setPage]        = useState(1);
  const [search, setSearch]    = useState('');
  const [loading, setLoading]  = useState(true);
  const debouncedSearch        = useDebounce(search, 400);

  const [banDialog, setBanDialog]       = useState<User | null>(null);
  const [roleDialog, setRoleDialog]     = useState<User | null>(null);
  const [banReason, setBanReason]       = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      const res  = await fetch(`/api/admin/users?${params}`, { headers });
      const data = await res.json();
      setUsers(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, accessToken]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleBan = async () => {
    if (!banDialog) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${banDialog.id}/ban`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: banReason }),
      });
      if (res.ok) {
        success('Đã chặn tài khoản', banDialog.email);
        fetchUsers();
      } else {
        error('Không thể thực hiện');
      }
    } catch {
      error('Lỗi kết nối');
    } finally {
      setActionLoading(false);
      setBanDialog(null);
      setBanReason('');
    }
  };

  const handleUnban = async (user: User) => {
    try {
      await fetch(`/api/admin/users/${user.id}/unban`, { method: 'PATCH', headers });
      success('Đã mở chặn', user.email);
      fetchUsers();
    } catch {
      error('Lỗi kết nối');
    }
  };

  const handleRoleChange = async () => {
    if (!roleDialog || !selectedRole) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${roleDialog.id}/role`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole }),
      });
      if (res.ok) {
        success('Đã thay đổi vai trò');
        fetchUsers();
      } else {
        error('Không thể thực hiện');
      }
    } catch {
      error('Lỗi kết nối');
    } finally {
      setActionLoading(false);
      setRoleDialog(null);
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'email',
      header: 'Email',
      cell: (u) => (
        <div>
          <p className="text-sm font-medium text-gray-900">{u.email}</p>
          <p className="text-xs text-gray-400">{u.fullName}</p>
        </div>
      ),
    },
    { key: 'role',   header: 'Vai trò',   cell: (u) => <StatusBadge status={u.role} />, sortable: true },
    { key: 'status', header: 'Trạng thái', cell: (u) => <StatusBadge status={u.status} />, sortable: true },
    { key: 'totalOrders', header: 'Đơn hàng', cell: (u) => <span className="text-sm">{u.totalOrders ?? 0}</span>, sortable: true },
    {
      key: 'createdAt',
      header: 'Ngày đăng ký',
      cell: (u) => <span className="text-xs text-gray-500">{new Date(u.createdAt).toLocaleDateString('vi-VN')}</span>,
      sortable: true,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      cell: (u) => (
        <div className="flex gap-2">
          {u.status === 'BANNED' ? (
            <button onClick={() => handleUnban(u)} className="text-xs text-green-600 hover:underline">Mở chặn</button>
          ) : (
            <button onClick={() => setBanDialog(u)} className="text-xs text-red-500 hover:underline">Chặn</button>
          )}
          <button
            onClick={() => { setRoleDialog(u); setSelectedRole(u.role); }}
            className="text-xs text-blue-600 hover:underline"
          >
            Đổi vai trò
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Quản lý người dùng</h1>
        <span className="text-sm text-gray-500">{total.toLocaleString()} người dùng</span>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Tìm kiếm theo email hoặc tên..."
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 focus:border-[#EE4D2D]"
        />
      </div>

      <DataTable columns={columns} data={users} loading={loading} keyFn={(u) => u.id} />

      {/* Pagination */}
      {total > 20 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">←</button>
          <span className="px-3 py-1.5 text-sm">Trang {page} / {Math.ceil(total / 20)}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 20)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">→</button>
        </div>
      )}

      {/* Ban dialog */}
      <Modal open={!!banDialog} onClose={() => setBanDialog(null)} title="Chặn tài khoản" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">Chặn tài khoản <strong>{banDialog?.email}</strong>?</p>
          <textarea
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Lý do chặn..."
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20"
          />
          <div className="flex justify-end gap-3">
            <button onClick={() => setBanDialog(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Huỷ</button>
            <button onClick={handleBan} disabled={actionLoading || !banReason.trim()} className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40">
              {actionLoading ? 'Đang xử lý...' : 'Chặn'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Role dialog */}
      <Modal open={!!roleDialog} onClose={() => setRoleDialog(null)} title="Thay đổi vai trò" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">Tài khoản: <strong>{roleDialog?.email}</strong></p>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex justify-end gap-3">
            <button onClick={() => setRoleDialog(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Huỷ</button>
            <button onClick={handleRoleChange} disabled={actionLoading} className="px-4 py-2 text-sm bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] disabled:opacity-40">
              {actionLoading ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
