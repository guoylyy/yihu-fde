# The image Yihu One builds for this app (see yh-app.json): one container where the backend also serves the built frontend.
# FDE runs only as a Yihu One app; there is no standalone deployment.
#
# Slow networks: docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#   --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma .
ARG NODE_IMAGE=node:20-alpine

# ---- frontend ----
FROM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY=
WORKDIR /src
COPY frontend/package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- backend + frontend build ----
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=
ARG PRISMA_ENGINES_MIRROR=
WORKDIR /app
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && if [ -z "$PRISMA_ENGINES_MIRROR" ]; then unset PRISMA_ENGINES_MIRROR; fi \
 && npm ci --omit=dev --no-audit --no-fund \
 && npx prisma generate
COPY backend/src ./src/
COPY backend/scripts ./scripts/
COPY --from=web /src/dist ./public
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/public
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
