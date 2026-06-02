FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY apps/web/package*.json ./
RUN npm ci --only=production

FROM base AS builder
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
