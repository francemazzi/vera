FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/label-runner/package.json apps/label-runner/package.json
RUN pnpm install --frozen-lockfile --filter @vera/label-runner...
COPY apps/label-runner apps/label-runner
RUN pnpm --filter @vera/label-runner build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "apps/label-runner/dist/main.js"]
