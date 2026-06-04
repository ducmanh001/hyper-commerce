'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Star, RefreshCw } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface PendingReview {
  id: string;
  userId: string;
  productId: string;
  rating: number;
  title?: string;
  content?: string;
  status: 'pending' | 'flagged';
  moderationScore?: number;
  verifiedPurchase: boolean;
  createdAt: string;
}

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';

// ── API helpers ────────────────────────────────────────────────

async function loadPending(page: number): Promise<{ items: PendingReview[]; total: number }> {
  const res = await fetch(`${GATEWAY}/api/v1/admin/reviews/pending?page=${page}&limit=20`);
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

async function approveReview(id: string): Promise<void> {
  const res = await fetch(`${GATEWAY}/api/v1/admin/reviews/${id}/approve`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to approve');
}

async function rejectReview(id: string, reason: string): Promise<void> {
  const res = await fetch(`${GATEWAY}/api/v1/admin/reviews/${id}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error('Failed to reject');
}

// ── Component ──────────────────────────────────────────────────

export function ReviewModerationClient() {
  const [items, setItems] = useState<PendingReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refresh = useCallback(async (p: number) => {
    setLoading(true);
    const data = await loadPending(p);
    setItems(data.items);
    setTotal(data.total);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(page); }, [page, refresh]);

  const handleApprove = async (id: string) => {
    setActionId(id);
    try {
      await approveReview(id);
      setItems((prev) => prev.filter((r) => r.id !== id));
      setTotal((t) => t - 1);
    } catch {
      // silently fail — show toast in production
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal || !rejectReason.trim()) return;
    setActionId(rejectModal.id);
    try {
      await rejectReview(rejectModal.id, rejectReason);
      setItems((prev) => prev.filter((r) => r.id !== rejectModal.id));
      setTotal((t) => t - 1);
    } finally {
      setActionId(null);
      setRejectModal(null);
      setRejectReason('');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kiểm duyệt đánh giá</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total} đánh giá chờ xét duyệt</p>
        </div>
        <button
          onClick={() => refresh(page)}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border rounded-lg px-3 py-2"
        >
          <RefreshCw className="w-4 h-4" /> Làm mới
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-gray-100 animate-pulse rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
          <p className="font-medium">Không có đánh giá nào chờ xét duyệt</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((review) => (
            <div key={review.id} className="border rounded-xl p-4 bg-white shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {/* Star rating */}
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={`w-3.5 h-3.5 ${s <= review.rating ? 'fill-yellow-400 stroke-yellow-400' : 'stroke-gray-200'}`} />
                      ))}
                    </div>
                    {/* Status badge */}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      review.status === 'flagged' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {review.status === 'flagged' ? '⚠ AI Flagged' : 'Pending'}
                    </span>
                    {review.moderationScore !== undefined && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        review.moderationScore > 0.7 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        Score: {review.moderationScore.toFixed(2)}
                      </span>
                    )}
                    {review.verifiedPurchase && (
                      <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">Đã mua</span>
                    )}
                  </div>
                  {review.title && <p className="font-semibold text-gray-900 text-sm">{review.title}</p>}
                  {review.content && (
                    <p className="text-gray-600 text-sm mt-0.5 line-clamp-3">{review.content}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    User {review.userId.slice(0, 8)} · Product {review.productId.slice(0, 8)} · {new Date(review.createdAt).toLocaleString('vi-VN')}
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(review.id)}
                    disabled={actionId === review.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500 text-white text-sm hover:bg-green-600 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" /> Duyệt
                  </button>
                  <button
                    onClick={() => setRejectModal({ id: review.id })}
                    disabled={actionId === review.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Từ chối
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex justify-center gap-2 mt-6">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">
            ← Trước
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-600">Trang {page} / {Math.ceil(total / 20)}</span>
          <button disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">
            Sau →
          </button>
        </div>
      )}

      {/* Reject reason modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h3 className="font-semibold text-gray-900">Lý do từ chối</h3>
            </div>
            <p className="text-sm text-gray-500 mb-3">Người dùng sẽ nhận được thông báo với lý do này.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Ví dụ: Nội dung vi phạm chính sách — spam, quảng cáo sản phẩm khác..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => { setRejectModal(null); setRejectReason(''); }}
                className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || actionId !== null}
                className="px-5 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50"
              >
                Xác nhận từ chối
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
