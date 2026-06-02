'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Heart, MessageSquare, Gift, DollarSign, Plus, Radio } from 'lucide-react';
import { formatVNDCompact } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

interface Stream {
  id: string; title: string; status: string;
  viewerCount: number; peakViewers: number;
  likes: number; comments: number; gifts: number; revenue: number;
  startedAt: string; endedAt?: string; thumbnailUrl: string;
}

export default function SellerLiveStreamsPage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const { success, error } = useToast();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  useEffect(() => {
    fetch('/api/seller/live-streams', { headers })
      .then((r) => r.json())
      .then((d) => { setStreams(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/seller/live-streams', { method: 'POST', headers });
      if (res.ok) {
        const newStream = await res.json();
        setStreams((prev) => [newStream, ...prev]);
        success('Đã tạo phòng livestream', 'Chuyển đến trang quản lý...');
        router.push(`/seller/live-streams/${newStream.id}`);
      } else error('Không thể tạo livestream');
    } catch { error('Lỗi kết nối'); }
    finally { setCreating(false); }
  };

  const liveStream = streams.find((s) => s.status === 'LIVE');
  const totalRevenue = streams.reduce((s, st) => s + st.revenue, 0);
  const totalPeakViewers = Math.max(...streams.map((s) => s.peakViewers), 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý Livestream</h1>
          <p className="text-sm text-gray-500">{streams.length} buổi phát sóng</p>
        </div>
        <button onClick={handleCreate} disabled={creating}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
          <Plus className="w-4 h-4" />
          {creating ? 'Đang tạo...' : 'Phát sóng mới'}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
          <p className="text-2xl font-bold text-gray-900">{formatVNDCompact(totalRevenue)}</p>
          <p className="text-xs text-gray-500 mt-1">Tổng doanh thu từ live</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalPeakViewers.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">Đỉnh khán giả</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
          <p className="text-2xl font-bold text-gray-900">{streams.length}</p>
          <p className="text-xs text-gray-500 mt-1">Tổng buổi live</p>
        </div>
      </div>

      {/* Live now banner */}
      {liveStream && (
        <div className="rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #EE4D2D, #B91C1C)' }}>
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/20 rounded-full px-2 py-1">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-bold">LIVE</span>
          </div>
          <p className="font-bold text-lg mb-1">{liveStream.title}</p>
          <div className="flex items-center gap-4 text-sm text-white/80">
            <span className="flex items-center gap-1"><Users className="w-4 h-4" />{liveStream.viewerCount.toLocaleString()} đang xem</span>
            <span className="flex items-center gap-1"><Heart className="w-4 h-4" />{liveStream.likes.toLocaleString()} thích</span>
            <span className="flex items-center gap-1"><Gift className="w-4 h-4" />{liveStream.gifts} quà</span>
          </div>
          <a href={`/live/${liveStream.id}`} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all">
            <Radio className="w-4 h-4" /> Vào phòng live
          </a>
        </div>
      )}

      {/* Stream list */}
      <div className="space-y-3">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl h-32 animate-pulse border border-gray-100" />
        )) : streams.filter((s) => s.status !== 'LIVE').map((s) => (
          <div key={s.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex">
            <img src={s.thumbnailUrl} alt={s.title} className="w-36 h-24 object-cover flex-shrink-0" />
            <div className="flex-1 p-4 flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900 line-clamp-1">{s.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(s.startedAt).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                    {s.endedAt && ` — ${Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)} phút`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.status === 'SCHEDULED' ? 'Đã lên lịch' : 'Đã kết thúc'}
                  </span>
                  <button
                    onClick={() => router.push(`/seller/live-streams/${s.id}`)}
                    className="text-xs text-[#EE4D2D] hover:underline font-medium"
                  >
                    Quản lý
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{s.peakViewers.toLocaleString()} đỉnh</span>
                <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{s.likes.toLocaleString()}</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{s.comments.toLocaleString()}</span>
                <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5 text-green-500" />{formatVNDCompact(s.revenue)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
