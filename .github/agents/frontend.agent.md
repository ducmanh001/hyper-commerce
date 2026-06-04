---
description: Next.js 14 App Router frontend — web storefront, seller dashboard, admin UI. Use for building pages, components, hooks, data fetching, real-time UI, and checkout flows.
applyTo: 'apps/web/**'
---

# Frontend Agent — Next.js Web App

## CONTEXT (read once, reuse)

You are an expert Next.js/React/TypeScript engineer building HyperCommerce web frontend.
**Do NOT re-read component files each time.** Load this context and work from it.

## Tech Stack

```
Framework:    Next.js 14 App Router (RSC by default)
Styling:      TailwindCSS + shadcn/ui components
State:        Zustand (global) + TanStack Query v5 (server state)
Forms:        React Hook Form + Zod
Realtime:     Socket.IO client
Payments:     Stripe Elements (PCI-compliant)
i18n:         next-intl (vi/en)
Testing:      Playwright (E2E) + Vitest (unit)
```

## App Router Conventions

```typescript
// Server Components (default) — no 'use client'
// Client Components — add 'use client' when needed (hooks, events, browser APIs)
// Route handlers — app/api/... for BFF

// Route Groups
app/
  (auth)/          login, register, reset-password
  (shop)/          home, products, cart, checkout
  (seller)/        seller dashboard, inventory, analytics
  (admin)/         admin console
  (user)/          profile, orders, wishlist, loyalty
  (live)/          livestream browsing + viewing
```

## Data Fetching

> Covered by `nextjs.instructions.md` — Server Component `fetch()` with ISR, TanStack Query for client state, optimistic mutations.

## API Client Pattern

```typescript
// apps/web/src/lib/api/
// One file per service domain
export const orderApi = {
  create: (dto: CreateOrderDto) => apiClient.post<OrderResponse>('/api/orders', dto),
  getById: (id: string) => apiClient.get<OrderResponse>(`/api/orders/${id}`),
};

// apiClient = axios instance with interceptors:
// - Attach Authorization header from session
// - Refresh token on 401
// - Error toast on 5xx
```

## Auth

> Covered by `nextjs.instructions.md` — httpOnly cookie, getServerSession, middleware matcher for `/seller/:path*` and `/admin/:path*`.

## Realtime (Socket.IO)

```typescript
// hooks/useSocket.ts
export function useSocket(namespace: string) {
  const socket = useRef<Socket>();
  useEffect(() => {
    socket.current = io(`${WS_URL}/${namespace}`, {
      auth: { token: getAccessToken() },
      transports: ['websocket'],
    });
    return () => socket.current?.disconnect();
  }, [namespace]);
  return socket.current;
}

// Usage in livestream viewer
const socket = useSocket('live');
socket.on('gift', (gift) => addGiftAnimation(gift));
socket.on('viewer_count', setViewerCount);
```

## Component Structure

```typescript
// shadcn/ui base components + custom variants
// components/ui/          → shadcn primitives
// components/common/      → shared: Header, Footer, LoadingSpinner
// components/product/     → ProductCard, ProductGallery, ReviewList
// components/order/       → OrderSummary, OrderTimeline
// components/live/        → StreamPlayer, GiftPanel, ChatBox
// components/seller/      → Dashboard widgets, charts

// Component file structure
export function ProductCard({ product }: { product: ProductDto }) {
  // 1. Hooks
  // 2. Derived state
  // 3. Handlers
  // 4. JSX
}
```

## Performance

> Covered by `nextjs.instructions.md` — next/image, dynamic() for client-only, react-virtual for long lists.

## Page Routes Map

```
/                         → Home feed (personalized products + live)
/products                 → Product catalog with filters
/products/[id]            → Product detail + reviews + variants
/cart                     → Cart with voucher input
/checkout                 → Multi-step checkout (address → payment → review)
/orders                   → Order history
/orders/[id]              → Order detail + tracking
/live                     → Livestream discovery grid
/live/[id]                → Livestream viewer
/notifications            → Notification center
/points                   → Loyalty points & rewards
/wishlist                 → Saved products
/referral                 → Referral program
/profile                  → User profile
/auth/login               → Login
/auth/register            → Registration
/auth/reset-password      → Password reset (⚠ NOT YET BUILT)
/flash-sale               → Flash sale countdown page
/search                   → Search results (⚠ NOT YET BUILT)
/seller/dashboard         → Seller overview
/seller/inventory         → Product management
/seller/orders            → Order management
/seller/analytics         → Revenue/conversion charts
/seller/subscription      → Plan management
/seller/live-streams      → Livestream sessions
/seller/ads               → Ads campaign manager
/seller/payments          → Payout history
/seller/disputes          → Dispute center
/admin                    → Admin console (11 sub-routes)
```

## State Architecture

```typescript
// Zustand stores
interface AppStore {
  // Auth
  user: UserDto | null;
  accessToken: string | null;
  // Cart (persisted to localStorage)
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  // UI state
  notifications: Notification[];
  socketConnected: boolean;
}

// TanStack Query — server cache keys
['products', { category, sort, page }][('product', id)][('cart', userId)][
  ('orders', { status, page })
][('seller.analytics', { period })];
```
