'use client';

import { useState, useEffect, useCallback } from 'react';
import { Star, ThumbsUp, Reply } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface Review {
  id: string;
  userId: string;
  rating: number;
  title?: string;
  content?: string;
  images: string[];
  helpfulCount: number;
  verifiedPurchase: boolean;
  sellerReply?: string;
  sellerRepliedAt?: string;
  createdAt: string;
}

interface RatingStats {
  productId: string;
  averageRating: number;
  totalCount: number;
  distribution: Record<string, number>;
}

interface ReviewSectionProps {
  productId: string;
  rating: number;
  reviewCount: number;
  /** If provided, shows the "Write Review" button */
  currentUserId?: string;
  currentOrderId?: string;
  sellerId?: string;
}

type SortOption = 'newest' | 'helpful' | 'rating_asc' | 'rating_desc';

// ── API helpers ────────────────────────────────────────────────

const REVIEW_API = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';

async function fetchReviews(productId: string, page: number, sort: SortOption): Promise<{ items: Review[]; total: number }> {
  const res = await fetch(
    `${REVIEW_API}/api/v1/reviews?productId=${productId}&page=${page}&limit=10&sort=${sort}`,
    { next: { revalidate: 60 } },
  );
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

async function fetchStats(productId: string): Promise<RatingStats | null> {
  const res = await fetch(`${REVIEW_API}/api/v1/reviews/product/${productId}/stats`, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return res.json();
}

async function submitReview(data: {
  userId: string; orderId: string; productId: string; sellerId: string;
  rating: number; title: string; content: string;
}) {
  const res = await fetch(`${REVIEW_API}/api/v1/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? 'Không thể gửi đánh giá');
  }
  return res.json();
}

async function markHelpful(reviewId: string, userId: string) {
  await fetch(`${REVIEW_API}/api/v1/reviews/${reviewId}/helpful`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

// ── Sub-components ─────────────────────────────────────────────

function StarRating({ value, onChange, readonly = false }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-5 h-5 cursor-${readonly ? 'default' : 'pointer'} transition-colors ${
            star <= (hovered || value) ? 'fill-yellow-400 stroke-yellow-400' : 'stroke-gray-300'
          }`}
          onMouseEnter={() => !readonly && setHovered(star)}
          onMouseLeave={() => !readonly && setHovered(0)}
          onClick={() => !readonly && onChange?.(star)}
        />
      ))}
    </div>
  );
}

function ReviewCard({ review, currentUserId }: { review: Review; currentUserId?: string }) {
  const [helped, setHelped] = useState(false);
  const [helpfulCount, setHelpfulCount] = useState(review.helpfulCount);

  const handleHelpful = async () => {
    if (!currentUserId || helped) return;
    setHelped(true);
    setHelpfulCount((c) => c + 1);
    await markHelpful(review.id, currentUserId).catch(() => {
      setHelped(false);
      setHelpfulCount((c) => c - 1);
    });
  };

  return (
    <div className="py-5 border-b last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StarRating value={review.rating} readonly />
            {review.verifiedPurchase && (
              <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                Đã mua hàng
              </span>
            )}
          </div>
          {review.title && <p className="font-semibold text-gray-900">{review.title}</p>}
          {review.content && <p className="text-gray-600 text-sm mt-1 leading-relaxed">{review.content}</p>}
          {review.images.length > 0 && (
            <div className="flex gap-2 mt-2">
              {review.images.slice(0, 5).map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={img} alt="" className="w-16 h-16 object-cover rounded-md border" />
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 mt-3">
            <span className="text-xs text-gray-400">
              {new Date(review.createdAt).toLocaleDateString('vi-VN')}
            </span>
            <button
              onClick={handleHelpful}
              disabled={!currentUserId || helped}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary-500 disabled:cursor-default disabled:opacity-60"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              Hữu ích ({helpfulCount})
            </button>
          </div>
        </div>
      </div>

      {review.sellerReply && (
        <div className="mt-3 ml-6 pl-4 border-l-2 border-gray-200 bg-gray-50 rounded-r-md py-2 pr-3">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Reply className="w-3.5 h-3.5" />
            <span className="font-medium">Phản hồi của người bán</span>
            {review.sellerRepliedAt && (
              <span>· {new Date(review.sellerRepliedAt).toLocaleDateString('vi-VN')}</span>
            )}
          </div>
          <p className="text-sm text-gray-700">{review.sellerReply}</p>
        </div>
      )}
    </div>
  );
}

function WriteReviewModal({
  productId, orderId, sellerId, userId,
  onSuccess, onClose,
}: {
  productId: string; orderId: string; sellerId: string; userId: string;
  onSuccess: () => void; onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) { setError('Vui lòng chọn số sao'); return; }
    setLoading(true);
    setError('');
    try {
      await submitReview({ userId, orderId, productId, sellerId, rating, title, content });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h3 className="font-semibold text-lg">Viết đánh giá</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Đánh giá của bạn *</label>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Tiêu đề (tùy chọn)</label>
            <input
              type="text" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Tóm tắt trải nghiệm của bạn"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Nội dung đánh giá</label>
            <textarea
              rows={4} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="Chia sẻ chi tiết trải nghiệm của bạn về sản phẩm này..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
            />
            <p className="text-xs text-gray-400 text-right mt-0.5">{content.length}/2000</p>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              Hủy
            </button>
            <button
              type="submit" disabled={loading}
              className="px-6 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-60"
            >
              {loading ? 'Đang gửi...' : 'Gửi đánh giá'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

export function ReviewSection({ productId, rating: initialRating, reviewCount: initialCount, currentUserId, currentOrderId, sellerId }: ReviewSectionProps) {
  const [stats, setStats] = useState<RatingStats | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortOption>('newest');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async (p: number, s: SortOption) => {
    setLoading(true);
    const [data, statsData] = await Promise.all([
      fetchReviews(productId, p, s),
      p === 1 ? fetchStats(productId) : Promise.resolve(null),
    ]);
    setReviews(data.items);
    setTotal(data.total);
    if (statsData) setStats(statsData);
    setLoading(false);
  }, [productId]);

  useEffect(() => { load(1, sort); }, [load, sort]);

  const avgRating = stats?.averageRating ?? initialRating;
  const totalCount = stats?.totalCount ?? initialCount;

  return (
    <section id="reviews" className="mt-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Đánh giá sản phẩm</h2>
        {currentUserId && currentOrderId && sellerId && !submitted && (
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600"
          >
            Viết đánh giá
          </button>
        )}
      </div>

      {/* Rating summary */}
      {totalCount > 0 && (
        <div className="flex items-center gap-8 mb-6 p-4 bg-gray-50 rounded-xl">
          <div className="text-center min-w-[80px]">
            <p className="text-5xl font-extrabold text-amber-500">{avgRating.toFixed(1)}</p>
            <div className="flex justify-center my-1">
              <StarRating value={Math.round(avgRating)} readonly />
            </div>
            <p className="text-sm text-gray-500">{totalCount.toLocaleString('vi-VN')} đánh giá</p>
          </div>
          <div className="flex-1 space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats?.distribution[star] ?? 0;
              const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 w-3 text-right">{star}</span>
                  <Star className="w-3.5 h-3.5 fill-yellow-400 stroke-yellow-400" />
                  <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div className="bg-yellow-400 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-gray-400 text-xs w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sort control */}
      {total > 0 && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="text-gray-500">Sắp xếp:</span>
          {(['newest', 'helpful', 'rating_desc', 'rating_asc'] as SortOption[]).map((s) => (
            <button
              key={s}
              onClick={() => { setSort(s); setPage(1); }}
              className={`px-3 py-1 rounded-full border ${sort === s ? 'bg-primary-500 text-white border-primary-500' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {{ newest: 'Mới nhất', helpful: 'Hữu ích nhất', rating_desc: '⭐ Cao → Thấp', rating_asc: '⭐ Thấp → Cao' }[s]}
            </button>
          ))}
        </div>
      )}

      {/* Review list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center">
          {submitted ? 'Đánh giá của bạn đang được xét duyệt.' : 'Chưa có đánh giá nào. Hãy là người đầu tiên!'}
        </p>
      ) : (
        <div>
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} currentUserId={currentUserId} />
          ))}
          {total > page * 10 && (
            <button
              onClick={() => { const np = page + 1; setPage(np); load(np, sort); }}
              className="mt-4 w-full py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Xem thêm đánh giá ({total - page * 10} còn lại)
            </button>
          )}
        </div>
      )}

      {/* Write review modal */}
      {showModal && currentUserId && currentOrderId && sellerId && (
        <WriteReviewModal
          productId={productId}
          orderId={currentOrderId}
          sellerId={sellerId}
          userId={currentUserId}
          onSuccess={() => { setShowModal(false); setSubmitted(true); load(1, sort); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </section>
  );
}

