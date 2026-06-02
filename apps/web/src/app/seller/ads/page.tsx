'use client';

import { useState, useEffect, useCallback } from 'react';
import { Megaphone, Play, Pause, Plus, TrendingUp } from 'lucide-react';
import { formatVND, formatVNDCompact } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { Modal } from '@/components/ui/Modal';

interface Campaign {
  id: string; name: string; status: string;
  budget: number; spent: number;
  impressions: number; clicks: number; ctr: number; roas: number;
  startsAt: string; endsAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  DRAFT:  'bg-gray-100 text-gray-600',
  ENDED:  'bg-gray-100 text-gray-400',
};

export default function SellerAdsPage() {
  const { accessToken } = useAuthStore();
  const { success, error } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [newName, setNewName]     = useState('');
  const [newBudget, setNewBudget] = useState('');
  const [newStart, setNewStart]   = useState('');
  const [newEnd, setNewEnd]       = useState('');
  const [saving, setSaving]       = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/seller/ads', { headers });
      const data = await res.json();
      setCampaigns(data.items ?? []);
    } catch { setCampaigns([]); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handleActivate = async (id: string) => {
    const res = await fetch(`/api/seller/ads/${id}/activate`, { method: 'POST', headers });
    if (res.ok) { success('Đã kích hoạt chiến dịch'); fetchCampaigns(); }
    else error('Không thể kích hoạt');
  };

  const handlePause = async (id: string) => {
    const res = await fetch(`/api/seller/ads/${id}/pause`, { method: 'POST', headers });
    if (res.ok) { success('Đã tạm dừng chiến dịch'); fetchCampaigns(); }
    else error('Không thể tạm dừng');
  };

  const handleCreate = async () => {
    if (!newName || !newBudget) return;
    setSaving(true);
    try {
      const res = await fetch('/api/seller/ads', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, budget: Number(newBudget), startsAt: newStart, endsAt: newEnd }),
      });
      if (res.ok) {
        success('Đã tạo chiến dịch');
        setCreating(false); setNewName(''); setNewBudget(''); setNewStart(''); setNewEnd('');
        fetchCampaigns();
      } else error('Không thể tạo chiến dịch');
    } catch { error('Lỗi kết nối'); }
    finally { setSaving(false); }
  };

  const totalSpend   = campaigns.reduce((s, c) => s + c.spent, 0);
  const totalImpress = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalClicks  = campaigns.reduce((s, c) => s + c.clicks, 0);
  const avgRoas      = campaigns.length > 0 ? campaigns.reduce((s, c) => s + c.roas, 0) / campaigns.length : 0;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý quảng cáo</h1>
          <p className="text-sm text-gray-500">{campaigns.filter((c) => c.status === 'ACTIVE').length} chiến dịch đang chạy</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl"
          style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
          <Plus className="w-4 h-4" /> Tạo chiến dịch
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Tổng chi tiêu', value: formatVNDCompact(totalSpend), icon: '💰' },
          { label: 'Lượt hiển thị', value: (totalImpress / 1000).toFixed(0) + 'K', icon: '👁️' },
          { label: 'Lượt click', value: totalClicks.toLocaleString(), icon: '🖱️' },
          { label: 'ROAS TB', value: `${avgRoas.toFixed(1)}x`, icon: '📈' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-2xl mb-1">{s.icon}</p>
            <p className="text-xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Campaign list */}
      <div className="space-y-3">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 animate-pulse h-28" />
        )) : campaigns.map((c) => {
          const spentPct = Math.min(100, Math.round((c.spent / c.budget) * 100));
          return (
            <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                    <Megaphone className="w-5 h-5 text-[#EE4D2D]" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(c.startsAt).toLocaleDateString('vi-VN')} — {new Date(c.endsAt).toLocaleDateString('vi-VN')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status] ?? 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
                  {c.status === 'ACTIVE' && (
                    <button onClick={() => handlePause(c.id)} className="p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100"><Pause className="w-3.5 h-3.5" /></button>
                  )}
                  {(c.status === 'PAUSED' || c.status === 'DRAFT') && (
                    <button onClick={() => handleActivate(c.id)} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100"><Play className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              </div>

              {/* Budget bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Chi tiêu: {formatVNDCompact(c.spent)}</span>
                  <span>Ngân sách: {formatVNDCompact(c.budget)} ({spentPct}%)</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100">
                  <div className="h-full rounded-full transition-all" style={{ width: `${spentPct}%`, background: spentPct > 80 ? '#EE4D2D' : '#22C55E' }} />
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Hiển thị', value: (c.impressions / 1000).toFixed(0) + 'K' },
                  { label: 'Click', value: c.clicks.toLocaleString() },
                  { label: 'CTR', value: `${c.ctr}%` },
                  { label: 'ROAS', value: `${c.roas}x` },
                ].map((m) => (
                  <div key={m.label} className="bg-gray-50 rounded-xl py-2">
                    <p className="text-sm font-bold text-gray-900">{m.value}</p>
                    <p className="text-xs text-gray-400">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Tạo chiến dịch quảng cáo" size="md">
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên chiến dịch</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="VD: Flash Sale Tháng 7"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ngân sách (VND)</label>
            <input type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="10000000"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày bắt đầu</label>
              <input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày kết thúc</label>
              <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm text-gray-600 border rounded-xl hover:bg-gray-50">Huỷ</button>
            <button onClick={handleCreate} disabled={!newName || !newBudget || saving}
              className="px-4 py-2 text-sm text-white rounded-xl disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
              {saving ? 'Đang tạo...' : 'Tạo chiến dịch'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
