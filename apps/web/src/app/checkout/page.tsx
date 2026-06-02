'use client';

// Multi-step checkout — Client Component because it has interactive form state
// Steps: 1) Address  2) Shipping method  3) Payment  4) Confirm
// WHY CLIENT: Can't server-render form state / payment SDK (Stripe, VNPay SDK requires browser)

import { useState } from 'react';
import { useCartStore } from '@/lib/store/cart';
import { clientApi } from '@/lib/api-client';
import { formatVND } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Check, ChevronRight } from 'lucide-react';
import type { Address } from '@/types';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

type Step = 'address' | 'shipping' | 'payment' | 'confirm';

const addressSchema = z.object({
  fullName: z.string().min(2, 'Vui lòng nhập họ tên'),
  phone: z.string().regex(/^(0|84)[0-9]{8,9}$/, 'Số điện thoại không hợp lệ'),
  province: z.string().min(1, 'Vui lòng chọn tỉnh/thành'),
  district: z.string().min(1, 'Vui lòng chọn quận/huyện'),
  ward: z.string().min(1, 'Vui lòng chọn phường/xã'),
  street: z.string().min(5, 'Vui lòng nhập địa chỉ cụ thể'),
});

type AddressForm = z.infer<typeof addressSchema>;

const SHIPPING_METHODS = [
  { id: 'STANDARD', label: 'Giao hàng tiêu chuẩn', subtitle: '3-5 ngày làm việc', fee: 30_000 },
  { id: 'EXPRESS', label: 'Giao hàng nhanh', subtitle: '1-2 ngày làm việc', fee: 55_000 },
  { id: 'SAME_DAY', label: 'Giao trong ngày', subtitle: 'Trước 22:00 hôm nay', fee: 99_000 },
];

const PAYMENT_METHODS = [
  { id: 'VNPAY', label: 'VNPay QR', icon: '🏦', desc: 'Quét mã QR thanh toán ngay' },
  { id: 'MOMO', label: 'Ví MoMo', icon: '🟣', desc: 'Thanh toán qua ứng dụng MoMo' },
  { id: 'CARD', label: 'Thẻ Visa/Mastercard', icon: '💳', desc: 'Thanh toán qua thẻ quốc tế' },
  { id: 'COD', label: 'Tiền mặt khi nhận hàng', icon: '💵', desc: 'Thanh toán khi nhận hàng' },
];

function StepIndicator({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'address', label: 'Địa chỉ' },
    { id: 'shipping', label: 'Vận chuyển' },
    { id: 'payment', label: 'Thanh toán' },
    { id: 'confirm', label: 'Xác nhận' },
  ];
  const idx = steps.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center mb-8">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center">
          <div className={`flex items-center gap-2 ${i <= idx ? 'text-primary-500' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2
              ${i < idx ? 'bg-primary-500 border-primary-500 text-white' : i === idx ? 'border-primary-500 text-primary-500' : 'border-gray-300 text-gray-400'}`}>
              {i < idx ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span className="text-sm font-medium hidden sm:block">{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className={`w-5 h-5 mx-2 ${i < idx ? 'text-primary-500' : 'text-gray-300'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function CheckoutPage() {
  const { items, voucherDiscount, voucherCode, clearCart, getSubtotal } = useCartStore();
  const [step, setStep] = useState<Step>('address');
  const [shippingMethod, setShippingMethod] = useState('STANDARD');
  const [paymentMethod, setPaymentMethod] = useState('VNPAY');
  const [address, setAddress] = useState<AddressForm | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const subtotal = getSubtotal();
  const shippingFee = SHIPPING_METHODS.find((m) => m.id === shippingMethod)?.fee ?? 30_000;
  const total = subtotal - voucherDiscount + shippingFee;

  const { register, handleSubmit, formState: { errors } } = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
  });

  if (items.length === 0) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-20 text-center">
          <p className="text-5xl mb-4">🛒</p>
          <h2 className="text-2xl font-bold mb-2">Giỏ hàng trống</h2>
          <p className="text-gray-500 mb-6">Thêm sản phẩm vào giỏ hàng trước khi thanh toán</p>
          <a href="/products" className="btn-primary">Tiếp tục mua sắm</a>
        </div>
        <Footer />
      </div>
    );
  }

  async function submitOrder() {
    if (!address) return;
    setIsSubmitting(true);
    try {
      const order = await clientApi.createOrder({
        items,
        shippingAddress: {
          fullName: address.fullName,
          phone: address.phone,
          province: address.province,
          district: address.district,
          ward: address.ward,
          street: address.street,
        },
        paymentMethod,
        voucherCode: voucherCode ?? undefined,
        shippingMethod,
      });
      clearCart();
      toast.success('Đặt hàng thành công! 🎉');
      router.push(`/account/orders/${order.id}?success=1`);
    } catch (e) {
      toast.error((e as Error).message ?? 'Đặt hàng thất bại');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Thanh Toán</h1>
        <StepIndicator current={step} />

        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Left: Steps */}
          <div className="flex-1 space-y-4">

            {/* Step 1: Address */}
            {step === 'address' && (
              <div className="card p-6">
                <h2 className="font-bold text-lg mb-4">Địa Chỉ Giao Hàng</h2>
                <form onSubmit={handleSubmit((data) => { setAddress(data); setStep('shipping'); })}
                  className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Họ và tên *</label>
                      <input {...register('fullName')} className="input-base" placeholder="Nguyễn Văn A" />
                      {errors.fullName && <p className="text-xs text-red-500 mt-1">{errors.fullName.message}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Số điện thoại *</label>
                      <input {...register('phone')} className="input-base" placeholder="0912345678" />
                      {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone.message}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tỉnh/Thành *</label>
                      <input {...register('province')} className="input-base" placeholder="Hà Nội" />
                      {errors.province && <p className="text-xs text-red-500 mt-1">{errors.province.message}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Quận/Huyện *</label>
                      <input {...register('district')} className="input-base" placeholder="Ba Đình" />
                      {errors.district && <p className="text-xs text-red-500 mt-1">{errors.district.message}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phường/Xã *</label>
                      <input {...register('ward')} className="input-base" placeholder="Liễu Giai" />
                      {errors.ward && <p className="text-xs text-red-500 mt-1">{errors.ward.message}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Địa chỉ cụ thể *</label>
                    <input {...register('street')} className="input-base" placeholder="Số nhà, tên đường..." />
                    {errors.street && <p className="text-xs text-red-500 mt-1">{errors.street.message}</p>}
                  </div>
                  <button type="submit" className="btn-primary w-full">Tiếp tục →</button>
                </form>
              </div>
            )}

            {/* Step 2: Shipping */}
            {step === 'shipping' && (
              <div className="card p-6">
                <h2 className="font-bold text-lg mb-4">Phương Thức Vận Chuyển</h2>
                <div className="space-y-3">
                  {SHIPPING_METHODS.map((m) => (
                    <label key={m.id} className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${shippingMethod === m.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="shipping" value={m.id} checked={shippingMethod === m.id} onChange={() => setShippingMethod(m.id)} className="accent-primary-500" />
                      <div className="flex-1">
                        <p className="font-medium">{m.label}</p>
                        <p className="text-sm text-gray-500">{m.subtitle}</p>
                      </div>
                      <span className="font-semibold text-gray-700">{formatVND(m.fee)}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setStep('address')} className="btn-outline flex-1">← Quay lại</button>
                  <button onClick={() => setStep('payment')} className="btn-primary flex-1">Tiếp tục →</button>
                </div>
              </div>
            )}

            {/* Step 3: Payment */}
            {step === 'payment' && (
              <div className="card p-6">
                <h2 className="font-bold text-lg mb-4">Phương Thức Thanh Toán</h2>
                <div className="space-y-3">
                  {PAYMENT_METHODS.map((m) => (
                    <label key={m.id} className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${paymentMethod === m.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="payment" value={m.id} checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} className="accent-primary-500" />
                      <span className="text-2xl">{m.icon}</span>
                      <div className="flex-1">
                        <p className="font-medium">{m.label}</p>
                        <p className="text-sm text-gray-500">{m.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setStep('shipping')} className="btn-outline flex-1">← Quay lại</button>
                  <button onClick={() => setStep('confirm')} className="btn-primary flex-1">Xem lại đơn hàng →</button>
                </div>
              </div>
            )}

            {/* Step 4: Confirm */}
            {step === 'confirm' && (
              <div className="card p-6">
                <h2 className="font-bold text-lg mb-4">Xác Nhận Đơn Hàng</h2>
                <div className="space-y-3 mb-6">
                  {items.map((item) => (
                    <div key={`${item.productId}-${item.variantId}`} className="flex gap-3 items-center">
                      <div className="w-12 h-12 bg-gray-100 rounded flex-shrink-0">
                        <img src={item.product.thumbnailUrl} alt={item.product.name} className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.product.name}</p>
                        <p className="text-xs text-gray-500">SL: {item.quantity}</p>
                      </div>
                      <span className="text-sm font-semibold">{formatVND(item.unitPrice * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('payment')} className="btn-outline flex-1">← Quay lại</button>
                  <button onClick={submitOrder} disabled={isSubmitting} className="btn-primary flex-1">
                    {isSubmitting ? 'Đang xử lý...' : '🎉 Đặt hàng ngay'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Order summary */}
          <div className="w-full lg:w-80 flex-shrink-0">
            <div className="card p-5 sticky top-24">
              <h3 className="font-bold mb-4">Tóm Tắt Đơn Hàng</h3>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-500">Tạm tính ({items.length} sản phẩm)</span>
                  <span>{formatVND(subtotal)}</span>
                </div>
                {voucherDiscount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Giảm giá voucher</span>
                    <span>-{formatVND(voucherDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Phí vận chuyển</span>
                  <span>{formatVND(shippingFee)}</span>
                </div>
              </div>
              <hr className="mb-3" />
              <div className="flex justify-between font-bold text-base">
                <span>Tổng thanh toán</span>
                <span className="text-primary-500 text-lg">{formatVND(total)}</span>
              </div>
              {voucherCode && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700">
                  🎫 Voucher <strong>{voucherCode}</strong> đã áp dụng
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
