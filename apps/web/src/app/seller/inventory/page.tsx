'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, AlertTriangle, RefreshCw, Search, TrendingDown } from 'lucide-react';
import { formatVND } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';
import { Modal } from '@/components/ui/Modal';

interface InventoryItem {
  productId: string; productName: string; sku: string;
  stock: number; reserved: number; available: number;
  threshold: number; isLowStock: boolean;
  lastRestocked: string; price: number;
}

export default function SellerInventoryPage() {
  const { accessToken } = useAuthStore();
  const { success, error } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (lowStockOnly) params.set('lowStock', 'true');
    try {
      const res  = await fetch(`/api/seller/inventory?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [accessToken, search, lowStockOnly]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  const handleAdjust = async () => {
    if (!adjustTarget || !adjustQty) return;
    setAdjustLoading(true);
    try {
      const res = await fetch(`/api/seller/inventory/${adjustTarget.productId}/adjust`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: Number(adjustQty), reason: adjustReason }),
      });
      if (res.ok) { success('Đã cập nhật kho hàng'); fetchInventory(); setAdjustTarget(null); setAdjustQty(''); setAdjustReason(''); }
      else error('Không thể cập nhật');
    } catch { error('Lỗi kết nối'); }
    finally { setAdjustLoading(false); }
  };

  const lowStockCount = items.filter((i) => i.isLowStock).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý kho hàng</h1>
          <p className="text-sm text-gray-500">{items.length} sản phẩm</p>
        </div>
        {lowStockCount > 0 && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-700 text-sm px-3 py-2 rounded-xl">
            <AlertTriangle className="w-4 h-4" />
            <span>{lowStockCount} sản phẩm sắp hết hàng</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm sản phẩm, SKU..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-3 py-2 cursor-pointer hover:bg-gray-50">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} className="accent-[#EE4D2D]" />
          Sắp hết hàng
        </label>
        <button onClick={fetchInventory} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Sản phẩm</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Tồn kho</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Đã đặt</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Khả dụng</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Giá</th>
              <th className="text-center px-4 py-3 text-gray-500 font-medium">Trạng thái</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : items.map((item) => (
              <tr key={item.productId} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${item.isLowStock ? 'bg-orange-50/30' : ''}`}>
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900 truncate max-w-[200px]">{item.productName}</p>
                    <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{item.stock.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-500">{item.reserved.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">{item.available.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-700">{formatVND(item.price)}</td>
                <td className="px-4 py-3 text-center">
                  {item.isLowStock ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                      <TrendingDown className="w-3 h-3" />Sắp hết
                    </span>
                  ) : (
                    <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Đủ hàng</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setAdjustTarget(item)}
                    className="text-xs font-medium text-[#EE4D2D] hover:underline">
                    Điều chỉnh
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <Package className="w-12 h-12 mb-3 opacity-30" />
            <p>Không tìm thấy sản phẩm nào</p>
          </div>
        )}
      </div>

      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title="Điều chỉnh tồn kho" size="sm">
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-sm font-semibold text-gray-900">{adjustTarget?.productName}</p>
            <p className="text-xs text-gray-500">Hiện tại: {adjustTarget?.stock} · Khả dụng: {adjustTarget?.available}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Số lượng thay đổi</label>
            <input type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} placeholder="+50 hoặc -10"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
            <p className="text-xs text-gray-400 mt-1">Dùng số dương để thêm, số âm để giảm</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lý do</label>
            <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Nhập hàng, kiểm kê, hỏng hàng..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20" />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setAdjustTarget(null)} className="px-4 py-2 text-sm text-gray-600 border rounded-xl hover:bg-gray-50">Huỷ</button>
            <button onClick={handleAdjust} disabled={!adjustQty || adjustLoading}
              className="px-4 py-2 text-sm text-white rounded-xl disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #EE4D2D, #FF6B35)' }}>
              {adjustLoading ? 'Đang lưu...' : 'Cập nhật'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
