# NEOS Work engine — single-process self-host image (Task 13)
# Build from monorepo root:
#   docker build -f deploy/Dockerfile -t neos-work:latest .

FROM node:22-bookworm AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/cli ./apps/cli
COPY skills ./skills
COPY design-systems ./design-systems
COPY plugins ./plugins

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @neos-work/shared build \
 && pnpm --filter @neos-work/core build \
 && pnpm --filter @neos-work/workflow-engine build \
 && pnpm --filter @neos-work/mcp-client build \
 && pnpm --filter @neos-work/browser-tool build \
 && pnpm --filter @neos-work/agent-runtime build \
 && pnpm --filter @neos-work/plugin-runtime build \
 && pnpm --filter @neos-work/server build

# Drop devDependencies for runtime image size
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEOS_HOST=0.0.0.0 \
    NEOS_PORT=3000 \
    NEOS_DATA_DIR=/data \
    NEOS_ALLOW_ANY_HOST=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Ensure native better-sqlite3 matches this image
RUN cd /app/apps/server && npm rebuild better-sqlite3 2>/dev/null || true

VOLUME ["/data"]
EXPOSE 3000
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
