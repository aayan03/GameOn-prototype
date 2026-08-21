# ── Build ──────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .

# Baked in at build time — Vite inlines it, so it cannot be changed later
# without rebuilding. That is why it is an ARG, not a runtime env var.
ARG VITE_API_URL=""
ARG VITE_MAP_PROVIDER="osm"
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_MAP_PROVIDER=$VITE_MAP_PROVIDER

RUN npm run build

# ── Serve ──────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Not in conf.d — nginx auto-includes conf.d/*.conf at http level, which
# would apply these headers twice on every response.
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
