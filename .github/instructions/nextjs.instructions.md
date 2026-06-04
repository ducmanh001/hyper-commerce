---
applyTo: 'apps/web/**/*.tsx,apps/web/**/*.ts'
---

# Next.js 14 App Router Conventions

## Routing model

- `page.tsx` = Server Component by default (SSR/ISR)
- Add `'use client'` only when: useState/useEffect/event handlers/browser APIs needed
- Split: `MyPage.tsx` (server, data fetch) + `MyPageClient.tsx` (interactive parts)
- `export const revalidate = 300` for product pages (5 min ISR)
- `export const dynamic = 'force-dynamic'` for admin/dashboard pages

## Data fetching

- Server components: `fetch()` with `next: { revalidate: N }` directly
- Client: TanStack Query (`useQuery`, `useMutation`)
- API base: `process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000'`
- Never call microservice URLs directly from the browser — always go through API Gateway

## Component conventions

- Use shadcn/ui components: `Button`, `Input`, `Dialog`, `Card` from `@/components/ui/`
- Icons: `lucide-react` only
- Tailwind class order: layout → spacing → color → typography → state
- Dark mode: `dark:` prefix classes where needed
- Currency: always `formatVND(amount)` from `@/lib/format`

## State management

- Server state: TanStack Query (no Zustand for remote data)
- Client/UI state: Zustand stores in `src/lib/stores/`
- Form state: `react-hook-form` + `zod` resolver

## Auth pattern

```typescript
// Server component — read session server-side
import { getServerSession } from 'next-auth';
const session = await getServerSession();

// Client component — useSession hook
import { useSession } from 'next-auth/react';
const { data: session } = useSession();
```

## Vietnamese locale

- Dates: `toLocaleDateString('vi-VN')`
- Numbers: `toLocaleString('vi-VN')`
- Currency: `formatVND(price)` → "1.250.000 ₫"
- User-facing text: Vietnamese preferred, English fallback

## Performance rules

- Images: always `next/image` with explicit `width`/`height` or `fill`
- No `<img>` tags (except when showing user-uploaded content with `// eslint-disable-next-line`)
- Heavy components: `dynamic(() => import(...), { ssr: false })` for client-only
- Avoid large client bundles: keep page.tsx as server component, push interaction to sub-components

## Security rules (frontend)

- API calls: always through `process.env.NEXT_PUBLIC_GATEWAY_URL` — NEVER call microservice ports directly
- No secrets in `NEXT_PUBLIC_` vars — those are visible in the browser bundle
- Server components: always `await getServerSession()` before rendering protected content; redirect if null
- Form data: validate with `zod` schema before calling API (`useForm + zodResolver`)
- Never use `dangerouslySetInnerHTML` with user-supplied content — use a sanitizer if truly needed
- CSP: images from user uploads must be served via CDN domain, not arbitrary URLs
