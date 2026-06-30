import type { Metadata } from 'next';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './globals.css';
import { AuthSessionBootstrap } from '@/components/auth/AuthSessionBootstrap';

export const metadata: Metadata = {
  title: {
    default: 'HyperCommerce — Mua sắm thông minh',
    template: '%s | HyperCommerce',
  },
  description:
    'Nền tảng thương mại điện tử hàng đầu Việt Nam — Hàng triệu sản phẩm, giao hàng nhanh, bảo vệ người mua.',
  keywords: ['mua sắm online', 'thương mại điện tử', 'hàng chính hãng'],
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://hypercommerce.vn'),
  openGraph: {
    type: 'website',
    locale: 'vi_VN',
    siteName: 'HyperCommerce',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-gray-50">
        <AuthSessionBootstrap />
        {children}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          pauseOnFocusLoss={false}
          draggable
          pauseOnHover
          theme="light"
        />
      </body>
    </html>
  );
}
