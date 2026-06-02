

// WHY NEXT.JS 14 APP ROUTER (not Vite/CRA/Remix)?
// - Server Components: product pages rendered at edge → <100ms TTFB → SEO ✅
// - App Router streaming: shell renders instantly, products stream in → better LCP
// - Image optimization built-in: WebP, AVIF, lazy load → mobile perf critical in VN
// - Nested layouts: avoid re-rendering Header/Footer on navigation → snappy SPA feel
// - API Routes as BFF: aggregate multiple microservice calls → 1 client round-trip

const nextConfig = {
  // -- Rewrites (BFF proxy to microservices) --
  // WHY REWRITES NOT DIRECT CALLS FROM BROWSER?
  // 1. CORS: browser can't call internal Docker services
  // 2. Security: hide internal service URLs/ports
  // 3. Auth injection: BFF adds Authorization header from session
  // 4. Aggregation: /api/products/:id fetches from search + inventory + ads in one call
  async rewrites() {
    return [];  // We use Next.js API routes for BFF — more control than pure rewrites
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.cloudfront.net' },
      { protocol: 'https', hostname: 'cdn.hypercommerce.vn' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'via.placeholder.com' },
      // Dev: allow any host
      { protocol: 'http', hostname: 'localhost' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  // Compress output
  compress: true,

  // Strict mode catches subtle React bugs early
  reactStrictMode: true,

  // Standalone output for Docker
  output: 'standalone',

  // Env vars exposed to client (prefix with NEXT_PUBLIC_)
  env: {
    NEXT_PUBLIC_APP_NAME: 'HyperCommerce',
    NEXT_PUBLIC_CURRENCY: 'VND',
    NEXT_PUBLIC_LOCALE: 'vi-VN',
  },

  // typedRoutes disabled: many pages (terms, help, account) not yet created
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
