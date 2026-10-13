FROM node:20-alpine

# Optional mirrors for slow networks, e.g.
#   docker compose build --build-arg APK_MIRROR=mirrors.aliyun.com --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG APK_MIRROR=
ARG NPM_REGISTRY=
ARG PRISMA_ENGINES_MIRROR=

# wget: health check
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#dl-cdn.alpinelinux.org#${APK_MIRROR}#g" /etc/apk/repositories; fi \
 && apk add --no-cache wget

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && if [ -z "$PRISMA_ENGINES_MIRROR" ]; then unset PRISMA_ENGINES_MIRROR; fi \
 && npm ci --omit=dev \
 && npx prisma generate

COPY src ./src/
COPY scripts ./scripts/

ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
