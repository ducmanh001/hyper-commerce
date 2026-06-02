import Link from 'next/link';

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 mt-12">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-white font-bold mb-3">HyperCommerce</h3>
            <p className="text-sm text-gray-500">
              Nền tảng thương mại điện tử hàng đầu Việt Nam. Mua sắm an toàn, giao hàng nhanh.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3 text-sm uppercase tracking-wide">Hỗ Trợ</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/help" className="hover:text-white transition-colors">Trung tâm hỗ trợ</Link></li>
              <li><Link href="/help/returns" className="hover:text-white transition-colors">Chính sách hoàn trả</Link></li>
              <li><Link href="/help/shipping" className="hover:text-white transition-colors">Chính sách vận chuyển</Link></li>
              <li><Link href="/disputes" className="hover:text-white transition-colors">Giải quyết tranh chấp</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3 text-sm uppercase tracking-wide">Người Bán</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/seller/register" className="hover:text-white transition-colors">Đăng ký bán hàng</Link></li>
              <li><Link href="/seller/dashboard" className="hover:text-white transition-colors">Trung tâm người bán</Link></li>
              <li><Link href="/seller/advertising" className="hover:text-white transition-colors">Quảng cáo sản phẩm</Link></li>
              <li><Link href="/seller/subscription" className="hover:text-white transition-colors">Gói dịch vụ</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3 text-sm uppercase tracking-wide">Thanh Toán</h4>
            <div className="flex flex-wrap gap-2">
              {['VNPay', 'MoMo', 'VISA', 'Mastercard', 'COD'].map((m) => (
                <span
                  key={m}
                  className="bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded font-mono"
                >
                  {m}
                </span>
              ))}
            </div>
            <div className="mt-4">
              <p className="text-xs text-gray-600">© 2026 HyperCommerce. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
