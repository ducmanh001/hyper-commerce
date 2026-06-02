'use client';

import { useState, useEffect } from 'react';
import { Crown, CheckCircle, Zap, AlertCircle } from 'lucide-react';
import { formatVND } from '@/lib/format';
import { useAuthStore } from '@/lib/store/auth';
import { useToast } from '@/lib/store/toast';

interface Plan { id: string; name: string; price: number; billingCycle: string; features: string[]; productLimit: number; commissionRate: number }
interface Invoice { id: string; amount: number; status: string; paidAt: string; period: string }
interface SubscriptionData {
  current: { planId: string; planName: string; price: number; billingCycle: string; status: string; nextBillingAt: string; cancelAt: string | null };
  plans:    Plan[];
  invoices: Invoice[];
}

const PLAN_COLORS: Record<string, string> = {
  Free: 'from-gray-400 to-gray-500',
  Basic: 'from-blue-500 to-blue-600',
  Professional: 'from-[#EE4D2D] to-[#FF6B35]',
  Enterprise: 'from-purple-600 to-indigo-600',
};

export default function SellerSubscriptionPage() {
  const { accessToken } = useAuthStore();
  const { success, error } = useToast();
  const [data, setData]   = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };

  useEffect(() => {
    fetch('/api/seller/subscription', { headers })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleCancel = async () => {
    if (!confirm('Bạn có chắc muốn huỷ gói dịch vụ? Gói sẽ kết thúc vào cuối chu kỳ hiện tại.')) return;
    setCancelling(true);
    try {
      const res = await fetch('/api/seller/subscription', { method: 'DELETE', headers });
      if (res.ok) success('Đã gửi yêu cầu huỷ gói', 'Gói sẽ hết hiệu lực vào cuối chu kỳ');
      else error('Không thể huỷ gói');
    } catch { error('Lỗi kết nối'); }
    finally { setCancelling(false); }
  };

  if (loading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 border-2 border-[#EE4D2D] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gói dịch vụ</h1>
        <p className="text-sm text-gray-500">Quản lý gói đăng ký và hoá đơn</p>
      </div>

      {/* Current plan */}
      {data?.current && (
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, #EE4D2D, #FF6B35)` }}>
          <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-8 -left-4 w-24 h-24 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-white/70 text-sm">Gói hiện tại</p>
                <p className="text-3xl font-black mt-0.5">{data.current.planName}</p>
              </div>
              <Crown className="w-8 h-8 text-white/60" />
            </div>
            <p className="text-2xl font-bold mb-1">{formatVND(data.current.price)}<span className="text-base font-normal text-white/70">/tháng</span></p>
            <div className="flex items-center gap-4 text-sm text-white/80 mt-3">
              <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4" />Trạng thái: {data.current.status === 'ACTIVE' ? 'Đang hoạt động' : data.current.status}</span>
              <span>Gia hạn: {new Date(data.current.nextBillingAt).toLocaleDateString('vi-VN')}</span>
            </div>
            {data.current.cancelAt === null && (
              <button onClick={handleCancel} disabled={cancelling}
                className="mt-4 text-sm bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl font-medium transition-all disabled:opacity-50">
                {cancelling ? 'Đang xử lý...' : 'Huỷ gói'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Plans */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Tất cả gói</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(data?.plans ?? []).map((plan) => {
            const isCurrentPlan = plan.id === data?.current.planId;
            const gradient = PLAN_COLORS[plan.name] ?? 'from-gray-400 to-gray-500';
            return (
              <div key={plan.id} className={`bg-white rounded-2xl p-5 shadow-sm border-2 transition-all ${isCurrentPlan ? 'border-[#EE4D2D]' : 'border-gray-100 hover:border-gray-200'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className={`inline-block px-3 py-1 rounded-xl text-white text-xs font-bold bg-gradient-to-r ${gradient} mb-2`}>{plan.name}</div>
                    <p className="text-2xl font-bold text-gray-900">
                      {plan.price === 0 ? 'Miễn phí' : formatVND(plan.price)}
                      {plan.price > 0 && <span className="text-sm font-normal text-gray-400">/tháng</span>}
                    </p>
                  </div>
                  {isCurrentPlan && (
                    <span className="text-xs font-bold bg-orange-50 text-[#EE4D2D] border border-orange-200 px-2 py-1 rounded-lg">Đang dùng</span>
                  )}
                </div>
                <div className="space-y-1.5 mb-4">
                  {plan.features.map((f) => (
                    <p key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />{f}
                    </p>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-3">
                  <span>Hoa hồng: <strong className="text-gray-700">{plan.commissionRate}%</strong></span>
                  <span>SP: <strong className="text-gray-700">{plan.productLimit === -1 ? '∞' : plan.productLimit}</strong></span>
                </div>
                {!isCurrentPlan && (
                  <button className="mt-3 w-full text-sm font-semibold py-2 rounded-xl border border-[#EE4D2D] text-[#EE4D2D] hover:bg-orange-50 transition-all">
                    Nâng cấp
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoices */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Lịch sử hoá đơn</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Kỳ thanh toán</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Số tiền</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">Trạng thái</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Ngày thanh toán</th>
              </tr>
            </thead>
            <tbody>
              {(data?.invoices ?? []).map((inv) => (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-700">{inv.period}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatVND(inv.amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${inv.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {inv.status === 'PAID' ? 'Đã thanh toán' : 'Chờ thanh toán'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">{new Date(inv.paidAt).toLocaleDateString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
