'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Timeline } from '@/components/ui/Timeline';
import { StatusBadge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatVND } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

interface OrderDetail {
  id:             string;
  status:         string;
  totalAmount:    number;
  shippingFee:    number;
  discount:       number;
  paymentMethod:  string;
  createdAt:      string;
  confirmedAt?:   string;
  shippedAt?:     string;
  deliveredAt?:   string;
  cancelledAt?:   string;
  trackingNumber?: string;
  sellerName:     string;
  shippingAddress: {
    fullName: string;
    phone:    string;
    address:  string;
  };
  items: Array<{
    id:          string;
    productId:   string;
    productName: string;
    imageUrl?:   string;
    quantity:    number;
    price:       number;
    variant?:    string;
  }>;
}

function buildTimeline(order: OrderDetail) {
  const steps = [
    {
      key:   'PENDING',
      label: 'Đặt hàng thành công',
      ts:    order.createdAt,
    },
    {
      key:   'CONFIRMED',
      label: 'Người bán xác nhận',
      ts:    order.confirmedAt,
    },
    {
      key:   'SHIPPED',
      label: 'Đang vận chuyển',
      ts:    order.shippedAt,
    },
    {
      key:   'DELIVERED',
      label: 'Đã giao hàng',
      ts:    order.deliveredAt,
    },
  ];

  const statusOrder = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
  const currentIdx  = statusOrder.indexOf(order.status);

  return steps.map((step, i) => ({
    label:     step.label,
    timestamp: step.ts ? new Date(step.ts).toLocaleString('vi-VN') : undefined,
    status:    i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending',
  })) as Array<{ label: string; timestamp?: string; status: 'done' | 'active' | 'pending' }>;
}

export default function OrderDetailPage() {
  const { id }                                  = useParams<{ id: string }>();
  const [order, setOrder]                       = useState<OrderDetail | null>(null);
  const [loading, setLoading]                   = useState(true);
  const [cancelDialog, setCancelDialog]         = useState(false);
  const [cancelling, setCancelling]             = useState(false);
  const accessToken                             = useAuthStore((s) => s.accessToken);
  const { success, error }                      = useToast();

  useEffect(() => {
    if (!id) return;
    fetch(`/api/orders/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then(setOrder)
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [id, accessToken]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        success('Huỷ đơn thành công');
        setOrder((o) => o ? { ...o, status: 'CANCELLED', cancelledAt: new Date().toISOString() } : o);
      } else {
        const data = await res.json();
        error('Không thể huỷ', data.message);
      }
    } catch {
      error('Lỗi kết nối');
    } finally {
      setCancelling(false);
      setCancelDialog(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-8 w-48" rounded />
          <Skeleton className="h-48 w-full" rounded />
          <Skeleton className="h-64 w-full" rounded />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">Không tìm thấy đơn hàng</p>
          <Link href="/orders" className="mt-4 inline-block text-[#EE4D2D] text-sm">← Quay lại</Link>
        </div>
      </div>
    );
  }

  const canCancel = ['PENDING', 'CONFIRMED'].includes(order.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Back */}
        <Link href="/orders" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
          ← Đơn mua
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status header */}
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 mb-1">MÃ ĐƠN HÀNG</p>
                <p className="font-mono font-bold text-gray-900">{order.id.slice(0, 12).toUpperCase()}</p>
              </div>
              <StatusBadge status={order.status} />
            </div>

            {/* Items */}
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-4">Sản phẩm ({order.items.length})</h3>
              <div className="space-y-4">
                {order.items.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                      {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.productName} fill className="object-cover" sizes="64px" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">📦</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link href={`/product/${item.productId}`} className="text-sm font-medium text-gray-900 hover:text-[#EE4D2D] line-clamp-2">
                        {item.productName}
                      </Link>
                      {item.variant && <p className="text-xs text-gray-400">{item.variant}</p>}
                      <p className="text-xs text-gray-500 mt-0.5">x{item.quantity}</p>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 flex-shrink-0">{formatVND(item.price * item.quantity)}</p>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="border-t border-gray-100 mt-4 pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Tạm tính</span>
                  <span>{formatVND(order.totalAmount - order.shippingFee + order.discount)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Phí vận chuyển</span>
                  <span>{order.shippingFee === 0 ? 'Miễn phí' : formatVND(order.shippingFee)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Giảm giá</span>
                    <span>−{formatVND(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100">
                  <span>Tổng thanh toán</span>
                  <span className="text-[#EE4D2D] text-lg">{formatVND(order.totalAmount)}</span>
                </div>
              </div>
            </div>

            {/* Shipping */}
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-3">Địa chỉ nhận hàng</h3>
              <p className="text-sm font-medium text-gray-800">{order.shippingAddress.fullName}</p>
              <p className="text-sm text-gray-500">{order.shippingAddress.phone}</p>
              <p className="text-sm text-gray-500">{order.shippingAddress.address}</p>
              {order.trackingNumber && (
                <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-600">Mã vận đơn: <span className="font-mono font-bold">{order.trackingNumber}</span></p>
                </div>
              )}
            </div>

            {/* Actions */}
            {canCancel && (
              <button
                onClick={() => setCancelDialog(true)}
                className="w-full py-3 border border-red-300 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Huỷ đơn hàng
              </button>
            )}
          </div>

          {/* Timeline sidebar */}
          <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm h-fit">
            <h3 className="font-semibold text-gray-900 mb-5">Trạng thái đơn hàng</h3>
            <Timeline events={buildTimeline(order)} />

            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500">Thanh toán qua</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">{order.paymentMethod}</p>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={cancelDialog}
        title="Huỷ đơn hàng"
        message="Bạn có chắc muốn huỷ đơn hàng này không? Thao tác không thể hoàn tác."
        confirmText="Huỷ đơn"
        cancelText="Giữ lại"
        danger
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setCancelDialog(false)}
      />
    </div>
  );
}
