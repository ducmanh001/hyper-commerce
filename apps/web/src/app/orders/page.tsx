import { Suspense } from 'react';
import { Metadata } from 'next';
import OrdersClient from './OrdersClient';

export const metadata: Metadata = {
  title: 'Đơn hàng của tôi | HyperCommerce',
};

export default function OrdersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Đơn mua</h1>
        <Suspense fallback={<div className="text-gray-500 text-sm">Đang tải...</div>}>
          <OrdersClient />
        </Suspense>
      </div>
    </div>
  );
}
