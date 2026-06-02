'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { Modal } from '@/components/ui/Modal';

interface RoleDefinition {
  role:        string;
  description: string;
  permissions: string[];
}

interface UserSearchResult {
  id:       string;
  email:    string;
  fullName: string;
  role:     string;
}

export default function AdminRolesPage() {
  const { accessToken }     = useAuthStore();
  const { success, error }  = useToast();
  const [roles, setRoles]   = useState<RoleDefinition[]>([]);
  const [assignDialog, setAssignDialog] = useState(false);
  const [userSearch, setUserSearch]     = useState('');
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [saving, setSaving]             = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  useEffect(() => {
    fetch('/api/admin/roles', { headers })
      .then((r) => r.json())
      .then((data) => setRoles(Array.isArray(data) ? data : (data.items ?? [])))
      .catch(() => setRoles([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchUser = async () => {
    if (!userSearch.trim()) return;
    try {
      const res  = await fetch(`/api/admin/users?q=${encodeURIComponent(userSearch)}&limit=5`, { headers });
      const data = await res.json();
      if (data.items?.length > 0) {
        setSelectedUser(data.items[0]);
        setSelectedRole(data.items[0].role);
      } else {
        error('Không tìm thấy người dùng');
      }
    } catch {
      error('Lỗi kết nối');
    }
  };

  const handleAssign = async () => {
    if (!selectedUser || !selectedRole) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/roles/${selectedUser.id}/assign`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, permissions: [] }),
      });
      if (res.ok) {
        success('Đã phân quyền', `${selectedUser.email} → ${selectedRole}`);
        setAssignDialog(false);
        setSelectedUser(null);
        setUserSearch('');
      } else {
        error('Không thể phân quyền');
      }
    } catch { error('Lỗi kết nối'); }
    finally { setSaving(false); }
  };

  const ROLE_COLORS: Record<string, string> = {
    SUPER_ADMIN:  'bg-purple-100 text-purple-700',
    ADMIN:        'bg-red-100 text-red-700',
    OPS:          'bg-blue-100 text-blue-700',
    FINANCE:      'bg-green-100 text-green-700',
    TRUST_SAFETY: 'bg-yellow-100 text-yellow-700',
    SELLER:       'bg-orange-100 text-orange-700',
    BUYER:        'bg-gray-100 text-gray-700',
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Quản lý phân quyền</h1>
        <button
          onClick={() => setAssignDialog(true)}
          className="px-4 py-2 bg-[#EE4D2D] text-white rounded-lg text-sm font-medium hover:bg-[#d43e20] transition-colors"
        >
          Gán vai trò
        </button>
      </div>

      <div className="space-y-4">
        {roles.map((roleDef) => (
          <div key={roleDef.role} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${ROLE_COLORS[roleDef.role] ?? 'bg-gray-100 text-gray-700'}`}>
                {roleDef.role}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{roleDef.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(roleDef.permissions ?? []).map((perm) => (
                    <span key={perm} className="text-xs bg-gray-50 border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                      {perm}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Assign role modal */}
      <Modal open={assignDialog} onClose={() => setAssignDialog(false)} title="Gán vai trò cho người dùng" size="sm">
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tìm người dùng</label>
            <div className="flex gap-2">
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchUser()}
                placeholder="Email hoặc tên..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
              <button onClick={handleSearchUser} className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">Tìm</button>
            </div>
          </div>

          {selectedUser && (
            <>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-800">{selectedUser.email}</p>
                <p className="text-xs text-blue-600">Vai trò hiện tại: {selectedUser.role}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vai trò mới</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                >
                  {roles.map((r) => <option key={r.role} value={r.role}>{r.role}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={() => setAssignDialog(false)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Huỷ</button>
            <button
              onClick={handleAssign}
              disabled={saving || !selectedUser || !selectedRole}
              className="px-4 py-2 text-sm bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] disabled:opacity-40"
            >
              {saving ? 'Đang lưu...' : 'Xác nhận'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
