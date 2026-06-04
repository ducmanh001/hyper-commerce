# ============================================================
# HYPERCOMMERCE — Multi-stage Dockerfile (shared base)
# Usage: Pass SERVICE=order-service as build arg
# ============================================================

ARG SERVICE=order-service
ARG NODE_VERSION=20-alpine

# ── Stage 1: Dependencies ─────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci --legacy-peer-deps

# ── Stage 2: Builder ──────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
ARG SERVICE

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the specific service
RUN npm run build -- ${SERVICE} --configuration production

# Remove dev dependencies
RUN npm ci --omit=dev --legacy-peer-deps

# ── Stage 3: Production ───────────────────────────────────────
FROM node:${NODE_VERSION} AS production
ARG SERVICE

# Security: run as non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1000 nestjs

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Environment
ENV NODE_ENV=production
ENV SERVICE=${SERVICE}

# Switch to non-root
USER nestjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:$PORT/health || exit 1

# Start the service
CMD ["node", "dist/apps/${SERVICE}/main"]

# Expose the port (optional, as it can be set at runtime)
