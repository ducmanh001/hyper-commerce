'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import { formatVND } from '@/lib/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function CartPage() {
  const { items, updateQuantity, removeItem, getSubtotal } = useCartStore();
  const subtotal = getSubtotal();
  const { success, error } = useToast();
  const [couponCode, setCouponCode]   = useState('');
  const [discount, setDiscount]       = useState(0);
  const [removingId, setRemovingId]   = useState<string | null>(null);

  const handleCoupon = async () => {
    if (!couponCode.trim()) return;
    // Stub — real impl calls /api/coupons/validate
    if (couponCode.toUpperCase() === 'WELCOME10') {
      setDiscount(0.1);
      success('Mã giảm giá hợp lệ', 'Giảm 10% cho đơn hàng');
    } else {
      error('Mã không hợp lệ', 'Vui lòng kiểm tra lại mã giảm giá');
    }
  };

  const finalPrice = subtotal * (1 - discount);
  const shippingFee = subtotal > 200000 ? 0 : 30000;

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <EmptyState
          icon="🛒"
          title="Giỏ hàng trống"
          message="Bạn chưa thêm sản phẩm nào vào giỏ hàng"
          action={
            <Link href="/" className="px-6 py-2.5 bg-[#EE4D2D] text-white rounded-lg text-sm font-medium hover:bg-[#d43e20] transition-colors">
              Tiếp tục mua sắm
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Giỏ hàng ({items.length} sản phẩm)</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Item list */}
          <div className="lg:col-span-2 space-y-3">
            {items.map((item) => (
              <div key={item.productId} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex gap-4">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                  {item.product.thumbnailUrl ? (
                    <Image src={item.product.thumbnailUrl} alt={item.product.name} fill className="object-cover" sizes="80px" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">📦</div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 line-clamp-2">{item.product.name}</p>
                  {item.variantId && <p className="text-xs text-gray-400 mt-0.5">Phân loại: {item.variantId}</p>}
                  <p className="text-[#EE4D2D] font-semibold mt-1">{formatVND(item.unitPrice)}</p>

                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => item.quantity > 1 ? updateQuantity(item.productId, item.variantId, item.quantity - 1) : null}
                        className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                        aria-label="Giảm"
                      >−</button>
                      <span className="w-10 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.productId, item.variantId, item.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                        aria-label="Tăng"
                      >+</button>
                    </div>

                    <button
                      onClick={() => setRemovingId(item.productId)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Xoá
                    </button>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-900">{formatVND(item.unitPrice * item.quantity)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="space-y-4">
            {/* Coupon */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Mã giảm giá</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Nhập mã giảm giá"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 focus:border-[#EE4D2D]"
                  onKeyDown={(e) => e.key === 'Enter' && handleCoupon()}
                />
                <button
                  onClick={handleCoupon}
                  className="px-4 py-2 text-sm bg-[#EE4D2D] text-white rounded-lg hover:bg-[#d43e20] transition-colors font-medium"
                >
                  Áp dụng
                </button>
              </div>
              {discount > 0 && (
                <p className="text-xs text-green-600 mt-2">Đã áp dụng giảm {discount * 100}%</p>
              )}
            </div>

            {/* Order summary */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Tóm tắt đơn hàng</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Tạm tính</span>
                  <span>{formatVND(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Giảm giá</span>
                    <span>−{formatVND(subtotal * discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Phí vận chuyển</span>
                  <span>{shippingFee === 0 ? <span className="text-green-600">Miễn phí</span> : formatVND(shippingFee)}</span>
                </div>
                <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-gray-900">
                  <span>Tổng cộng</span>
                  <span className="text-[#EE4D2D] text-lg">{formatVND(finalPrice + shippingFee)}</span>
                </div>
              </div>

              <Link
                href="/checkout"
                className="mt-4 block text-center w-full py-3 bg-[#EE4D2D] text-white rounded-xl font-semibold hover:bg-[#d43e20] transition-colors"
              >
                Thanh toán ngay
              </Link>
              <Link
                href="/"
                className="mt-2 block text-center text-sm text-gray-500 hover:text-gray-700"
              >
                Tiếp tục mua sắm
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm remove dialog */}
      <ConfirmDialog
        open={!!removingId}
        title="Xoá sản phẩm"
        message="Bạn có chắc muốn xoá sản phẩm này khỏi giỏ hàng?"
        confirmText="Xoá"
        danger
        onConfirm={() => {
          if (removingId) removeItem(removingId);
          setRemovingId(null);
        }}
        onCancel={() => setRemovingId(null)}
      />
    </div>
  );
}
