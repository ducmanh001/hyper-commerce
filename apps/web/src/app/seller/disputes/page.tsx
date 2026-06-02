'use client';

import { useState, useEffect } from 'react';
import { Scale, Clock, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react';
import { formatVND } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { Modal } from '@/components/ui/Modal';

interface Dispute {
  id: string; orderId: string; buyerName: string;
  reason: string; status: string; amount: number;
  createdAt: string; deadline: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  OPEN:      { label: 'Chờ phản hồi', cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3.5 h-3.5" /> },
  RESPONDED: { label: 'Đã phản hồi', cls: 'bg-blue-100 text-blue-700', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  RESOLVED:  { label: 'Đã giải quyết', cls: 'bg-green-100 text-green-700', icon: <CheckCircle className="w-3.5 h-3.5" /> },
};

export default function SellerDisputesPage() {
  const { accessToken } = useAuthStore();
  const { success, error } = useToast();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading]   = useState(true);
  const [target, setTarget]     = useState<Dispute | null>(null);
  const [response, setResponse] = useState('');
  const [saving, setSaving]     = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  useEffect(() => {
    fetch('/api/seller/disputes', { headers })
      .then((r) => r.json())
      .then((d) => { setDisputes(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleRespond = async () => {
    if (!target || !response.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/seller/disputes/${target.id}/respond`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (res.ok) {
        success('Đã gửi phản hồi');
        setDisputes((prev) => prev.map((d) => d.id === target.id ? { ...d, status: 'RESPONDED' } : d));
        setTarget(null); setResponse('');
      } else error('Không thể gửi phản hồi');
    } catch { error('Lỗi kết nối'); }
    finally { setSaving(false); }
  };

  const openCount = disputes.filter((d) => d.status === 'OPEN').length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tranh chấp đơn hàng</h1>
          <p className="text-sm text-gray-500">{disputes.length} tranh chấp · {openCount} cần xử lý</p>
        </div>
        {openCount > 0 && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-xl">
            <AlertCircle className="w-4 h-4" />
            <span>{openCount} tranh chấp cần phản hồi</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 h-24 animate-pulse border border-gray-100" />
        )) : disputes.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
            <Scale className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="text-gray-400">Không có tranh chấp nào</p>
          </div>
        ) : disputes.map((d) => {
          const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG['OPEN'];
          const daysLeft = Math.ceil((new Date(d.deadline).getTime() - Date.now()) / 86400000);
          return (
            <div key={d.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>
                      {cfg.icon}{cfg.label}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">#ORD-{d.orderId.slice(-6)}</span>
                  </div>
                  <p className="font-medium text-gray-900 mb-1">{d.reason}</p>
                  <p className="text-sm text-gray-500">Người mua: <span className="font-medium">{d.buyerName}</span></p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-lg text-gray-900">{formatVND(d.amount)}</p>
                  {d.status !== 'RESOLVED' && (
                    <p className={`text-xs flex items-center gap-1 justify-end mt-1 ${daysLeft <= 2 ? 'text-red-500' : 'text-gray-400'}`}>
                      <Clock className="w-3 h-3" />
                      {daysLeft > 0 ? `Còn ${daysLeft} ngày` : 'Đã hết hạn'}
                    </p>
                  )}
                </div>
              </div>
              {d.status === 'OPEN' && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => setTarget(d)}
                    className="text-sm font-semibold text-white px-4 py-2 rounded-xl"
                    style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
                    Phản hồi ngay
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={!!target} onClose={() => setTarget(null)} title="Phản hồi tranh chấp" size="md">
        <div className="p-5 space-y-4">
          {target && (
            <div className="bg-red-50 rounded-xl p-3 border border-red-100">
              <p className="text-sm font-medium text-red-800">{target.reason}</p>
              <p className="text-xs text-red-500 mt-1">Giá trị: {formatVND(target.amount)} · Người mua: {target.buyerName}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phản hồi của bạn</label>
            <textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={5}
              placeholder="Giải thích chi tiết về đơn hàng, bằng chứng giao hàng, hoặc đề xuất giải quyết..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 resize-none" />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setTarget(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-xl hover:bg-gray-50">Huỷ</button>
            <button onClick={handleRespond} disabled={!response.trim() || saving}
              className="px-4 py-2 text-sm text-white rounded-xl disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
              {saving ? 'Đang gửi...' : 'Gửi phản hồi'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
