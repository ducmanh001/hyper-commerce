'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';
import { StatusBadge } from '@/components/ui/Badge';
import { OrderCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatVND } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';

type OrderStatus = 'ALL' | 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';

interface OrderItem {
  id:          string;
  productName: string;
  imageUrl?:   string;
  quantity:    number;
  price:       number;
}

interface Order {
  id:          string;
  status:      string;
  totalAmount: number;
  createdAt:   string;
  items:       OrderItem[];
  sellerName?: string;
}

const STATUS_TABS: { key: OrderStatus; label: string }[] = [
  { key: 'ALL',        label: 'Tất cả' },
  { key: 'PENDING',    label: 'Chờ xác nhận' },
  { key: 'PROCESSING', label: 'Đang xử lý' },
  { key: 'SHIPPED',    label: 'Đang giao' },
  { key: 'DELIVERED',  label: 'Đã giao' },
  { key: 'CANCELLED',  label: 'Đã huỷ' },
];

export default function OrdersClient() {
  const [status, setStatus]   = useState<OrderStatus>('ALL');
  const [orders, setOrders]   = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const accessToken           = useAuthStore((s) => s.accessToken);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (status !== 'ALL') params.set('status', status);
      const res  = await fetch(`/api/orders?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      setOrders(data.items ?? []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [status, accessToken]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const tabs = STATUS_TABS.map((t) => ({
    key:     t.key,
    label:   t.label,
    content: null as unknown as React.ReactNode,
  }));

  const content = (
    <div className="space-y-3">
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => <OrderCardSkeleton key={i} />)
      ) : orders.length === 0 ? (
        <EmptyState
          icon="📦"
          title="Chưa có đơn hàng"
          message={status === 'ALL' ? 'Bạn chưa đặt đơn hàng nào' : `Không có đơn hàng ở trạng thái này`}
        />
      ) : (
        orders.map((order) => <OrderCard key={order.id} order={order} />)
      )}
    </div>
  );

  return (
    <Tabs
      tabs={STATUS_TABS.map((t) => ({
        key:     t.key,
        label:   t.label,
        content: content,
      }))}
      defaultTab="ALL"
      onChange={(key) => setStatus(key as OrderStatus)}
    />
  );
}

function OrderCard({ order }: { order: Order }) {
  const firstItem = order.items?.[0];

  return (
    <Link href={`/orders/${order.id}`}>
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex justify-between items-center mb-3">
          <div>
            <span className="text-xs text-gray-400">Mã đơn: </span>
            <span className="text-xs font-mono font-medium text-gray-700">{order.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {firstItem && (
          <div className="flex gap-3">
            <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
              {firstItem.imageUrl ? (
                <Image src={firstItem.imageUrl} alt={firstItem.productName} fill className="object-cover" sizes="64px" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">📦</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 line-clamp-2">{firstItem.productName}</p>
              {order.items.length > 1 && (
                <p className="text-xs text-gray-400 mt-0.5">+{order.items.length - 1} sản phẩm khác</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {new Date(order.createdAt).toLocaleDateString('vi-VN')}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-500">{order.sellerName}</span>
          <span className="font-bold text-[#EE4D2D]">{formatVND(order.totalAmount)}</span>
        </div>
      </div>
    </Link>
  );
}
