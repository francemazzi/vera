FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/label-governance/package.json apps/label-governance/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/extractors/package.json packages/extractors/package.json
COPY packages/rag/package.json packages/rag/package.json
COPY packages/rules-core/package.json packages/rules-core/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN pnpm install --frozen-lockfile --filter @vera/label-governance...

COPY apps/label-governance apps/label-governance
COPY packages/contracts packages/contracts
COPY packages/extractors packages/extractors
COPY packages/rag packages/rag
COPY packages/rules-core packages/rules-core
COPY packages/storage packages/storage
RUN pnpm --filter @vera/contracts build \
  && pnpm --filter @vera/extractors build \
  && pnpm --filter @vera/rag build \
  && pnpm --filter @vera/rules-core build \
  && pnpm --filter @vera/storage generate \
  && pnpm --filter @vera/storage build \
  && pnpm --filter @vera/label-governance build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "apps/label-governance/dist/main.js"]
