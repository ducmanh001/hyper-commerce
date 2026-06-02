'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface FeatureFlag {
  key:             string;
  description:     string;
  enabled:         boolean;
  rollout_percent: number;
  environments:    string[];
  owner?:          string;
  expires_at?:     string;
  updated_at:      string;
}

const EMPTY_FLAG: Omit<FeatureFlag, 'updated_at'> = {
  key:             '',
  description:     '',
  enabled:         false,
  rollout_percent: 100,
  environments:    ['production'],
  owner:           '',
  expires_at:      '',
};

export default function AdminFeatureFlagsPage() {
  const { accessToken }       = useAuthStore();
  const { success, error }    = useToast();
  const [flags, setFlags]     = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editFlag, setEditFlag]     = useState<Partial<FeatureFlag> & { key: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeatureFlag | null>(null);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/admin/feature-flags', { headers });
      const data = await res.json();
      setFlags(Array.isArray(data) ? data : (data.items ?? []));
    } catch {
      setFlags([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const handleToggle = async (flag: FeatureFlag) => {
    try {
      await fetch(`/api/admin/feature-flags/${flag.key}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...flag, enabled: !flag.enabled }),
      });
      setFlags((prev) => prev.map((f) => f.key === flag.key ? { ...f, enabled: !f.enabled } : f));
    } catch { error('Không thể cập nhật'); }
  };

  const handleSave = async () => {
    if (!editFlag?.key) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/feature-flags/${editFlag.key}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(editFlag),
      });
      success('Đã lưu feature flag');
      fetchFlags();
      setEditFlag(null);
    } catch { error('Không thể lưu'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/admin/feature-flags/${deleteTarget.key}`, { method: 'DELETE', headers });
      success('Đã xoá feature flag');
      fetchFlags();
    } catch { error('Không thể xoá'); }
    finally { setDeleting(false); setDeleteTarget(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
        <button
          onClick={() => setEditFlag({ ...EMPTY_FLAG })}
          className="px-4 py-2 bg-[#EE4D2D] text-white rounded-lg text-sm font-medium hover:bg-[#d43e20] transition-colors"
        >
          + Thêm flag
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Chưa có feature flag nào</div>
      ) : (
        <div className="space-y-3">
          {flags.map((flag) => (
            <div key={flag.key} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">{flag.key}</span>
                    {flag.rollout_percent < 100 && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        {flag.rollout_percent}% rollout
                      </span>
                    )}
                    {flag.expires_at && new Date(flag.expires_at) < new Date() && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Hết hạn</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{flag.description}</p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {flag.environments?.map((env) => (
                      <span key={env} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{env}</span>
                    ))}
                    {flag.owner && <span className="text-xs text-gray-400">Chủ sở hữu: {flag.owner}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(flag)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${flag.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                    aria-label={flag.enabled ? 'Tắt' : 'Bật'}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${flag.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>

                  <button onClick={() => setEditFlag({ ...flag })} className="text-xs text-blue-600 hover:underline">Sửa</button>
                  <button onClick={() => setDeleteTarget(flag)} className="text-xs text-red-500 hover:underline">Xoá</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Create modal */}
      <Modal open={!!editFlag} onClose={() => setEditFlag(null)} title={editFlag?.updated_at ? 'Chỉnh sửa Flag' : 'Tạo Flag mới'} size="md">
        {editFlag && (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Key (duy nhất)</label>
              <input
                value={editFlag.key}
                onChange={(e) => setEditFlag((f) => f ? { ...f, key: e.target.value } : f)}
                disabled={!!editFlag.updated_at}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                placeholder="feature.new-checkout"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mô tả</label>
              <input
                value={editFlag.description ?? ''}
                onChange={(e) => setEditFlag((f) => f ? { ...f, description: e.target.value } : f)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Rollout %</label>
                <input
                  type="number"
                  min={0} max={100}
                  value={editFlag.rollout_percent ?? 100}
                  onChange={(e) => setEditFlag((f) => f ? { ...f, rollout_percent: Number(e.target.value) } : f)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Hết hạn</label>
                <input
                  type="date"
                  value={editFlag.expires_at?.slice(0, 10) ?? ''}
                  onChange={(e) => setEditFlag((f) => f ? { ...f, expires_at: e.target.value } : f)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="flag-enabled"
                checked={editFlag.enabled ?? false}
                onChange={(e) => setEditFlag((f) => f ? { ...f, enabled: e.target.checked } : f)}
                className="accent-[#EE4D2D]"
              />
              <label htmlFor="flag-enabled" className="text-sm text-gray-700">Bật flag</label>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditFlag(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Huỷ</button>
              <button
                onClick={handleSave}
                disabled={saving || !editFlag.key}
                className="px-4 py-2 text-sm bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] disabled:opacity-40"
              >
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Xoá feature flag"
        message={`Xoá flag "${deleteTarget?.key}"? Thao tác không thể hoàn tác.`}
        confirmText="Xoá"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
