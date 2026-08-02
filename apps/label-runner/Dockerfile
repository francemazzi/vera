FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/label-runner/package.json apps/label-runner/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/extractors/package.json packages/extractors/package.json
COPY packages/rag/package.json packages/rag/package.json
RUN pnpm install --frozen-lockfile --filter @vera/label-runner...
COPY apps/label-runner apps/label-runner
COPY packages/contracts packages/contracts
COPY packages/extractors packages/extractors
COPY packages/rag packages/rag
RUN pnpm --filter @vera/contracts build \
  && pnpm --filter @vera/extractors build \
  && pnpm --filter @vera/rag build \
  && pnpm --filter @vera/label-runner build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "apps/label-runner/dist/main.js"]
