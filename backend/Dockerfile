# ── Build ──────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# npm ci needs a lockfile; fall back so a fresh clone still builds.
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ── Run ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# dumb-init reaps zombies and forwards SIGTERM, so the graceful shutdown in
# server.js actually runs instead of the container being killed outright.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=5000

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Never run as root. The node image ships a `node` user for exactly this.
USER node

EXPOSE 5000

# Readiness, not liveness — see routes/index.js for why they differ.
HEALTHCHECK --interval=30s --timeout=4s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
