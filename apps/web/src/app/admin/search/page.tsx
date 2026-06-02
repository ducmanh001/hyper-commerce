'use client';

import { useState, useEffect } from 'react';
import { Search, TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

interface TopQuery {
  query: string; count: number; clickRate: number; zeroResultRate: number; trend: string;
}

const TREND_ICON: Record<string, React.ReactNode> = {
  UP:     <TrendingUp className="w-3.5 h-3.5 text-green-500" />,
  DOWN:   <TrendingDown className="w-3.5 h-3.5 text-red-500" />,
  STABLE: <Minus className="w-3.5 h-3.5 text-gray-400" />,
};

export default function AdminSearchPage() {
  const { accessToken } = useAuthStore();
  const { success, error } = useToast();
  const [queries, setQueries]       = useState<TopQuery[]>([]);
  const [loading, setLoading]       = useState(true);
  const [reindexId, setReindexId]   = useState('');
  const [reindexLoading, setReindexLoading] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  useEffect(() => {
    fetch('/api/admin/search', { headers })
      .then((r) => r.json())
      .then((d) => { setQueries(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleReindex = async () => {
    if (!reindexId.trim()) return;
    setReindexLoading(true);
    try {
      const res = await fetch('/api/admin/search', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: reindexId.trim() }),
      });
      if (res.ok) { success('Đã đưa vào hàng chờ reindex', `Product: ${reindexId}`); setReindexId(''); }
      else error('Không thể trigger reindex');
    } catch { error('Lỗi kết nối'); }
    finally { setReindexLoading(false); }
  };

  const avgClickRate    = queries.length > 0 ? (queries.reduce((s, q) => s + q.clickRate, 0) / queries.length).toFixed(2) : '0';
  const zeroResultCount = queries.filter((q) => q.zeroResultRate > 0.1).length;
  const totalSearches   = queries.reduce((s, q) => s + q.count, 0);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Search Management</h1>
        <p className="text-sm text-gray-500">Phân tích truy vấn & quản lý search index</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Tổng lượt tìm kiếm</p>
          <p className="text-2xl font-bold text-gray-900">{(totalSearches / 1000).toFixed(0)}K</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Click rate trung bình</p>
          <p className="text-2xl font-bold text-gray-900">{avgClickRate}</p>
        </div>
        <div className={`rounded-2xl p-4 shadow-sm border ${zeroResultCount > 3 ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100'}`}>
          <p className={`text-sm mb-1 ${zeroResultCount > 3 ? 'text-orange-600' : 'text-gray-500'}`}>Truy vấn không kết quả cao</p>
          <p className={`text-2xl font-bold ${zeroResultCount > 3 ? 'text-orange-700' : 'text-gray-900'}`}>{zeroResultCount}</p>
        </div>
      </div>

      {/* Reindex tool */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-3">Trigger Reindex</h3>
        <p className="text-sm text-gray-500 mb-3">Đưa một sản phẩm vào hàng chờ reindex trong Elasticsearch + vector store.</p>
        <div className="flex gap-3">
          <input value={reindexId} onChange={(e) => setReindexId(e.target.value)}
            placeholder="Product ID (VD: prod-1)"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
          <button onClick={handleReindex} disabled={!reindexId.trim() || reindexLoading}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
            <RefreshCw className={`w-4 h-4 ${reindexLoading ? 'animate-spin' : ''}`} />
            {reindexLoading ? 'Đang xử lý...' : 'Reindex'}
          </button>
        </div>
      </div>

      {/* Top queries table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Top truy vấn tìm kiếm</h3>
          <span className="text-xs text-gray-400">{queries.length} queries</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-5 py-3 text-gray-500 font-medium w-8">#</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Truy vấn</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Lượt tìm</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Click rate</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Zero result</th>
              <th className="text-center px-4 py-3 text-gray-500 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-50">
                {Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}
              </tr>
            )) : queries.map((q, i) => (
              <tr key={q.query} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3 text-gray-400 font-medium">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    <span className="font-medium text-gray-900">{q.query}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{q.count.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${q.clickRate >= 0.5 ? 'text-green-600' : q.clickRate >= 0.3 ? 'text-yellow-600' : 'text-red-500'}`}>
                    {(q.clickRate * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${q.zeroResultRate > 0.1 ? 'text-orange-600' : 'text-gray-500'}`}>
                    {(q.zeroResultRate * 100).toFixed(0)}%
                  </span>
                  {q.zeroResultRate > 0.1 && <AlertTriangle className="w-3 h-3 text-orange-500 inline ml-1" />}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="flex items-center justify-center">{TREND_ICON[q.trend]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
