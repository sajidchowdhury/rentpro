# syntax=docker/dockerfile:1
# ============================================================================
# RentPro — multi-stage production Dockerfile (Next.js 16 standalone)
# ----------------------------------------------------------------------------
# Stages: deps (bun install) -> builder (prisma generate + next build) ->
# runner (lean node:20-alpine running the standalone server).
# ============================================================================

# ---- 1. deps ----
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install

# ---- 2. builder ----
FROM oven/bun:1-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# generate the Prisma client (harmless if unused at runtime; needed if you
# swap the data layer to Prisma or run migrate:write inside the container)
RUN bunx prisma generate
# Next.js standalone build -> .next/standalone (server.js + traced deps)
RUN bun run build

# ---- 3. runner (production) ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
# standalone server + its traced node_modules
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
# static assets + public (not bundled by standalone — copy explicitly)
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/months').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
