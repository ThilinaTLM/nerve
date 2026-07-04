# Build from repository root after pnpm builds the manager and sandbox-manager-ui.
FROM node:24-bookworm-slim AS manager-deps

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/dist packages/shared/dist
COPY packages/sandbox-manager/package.json packages/sandbox-manager/package.json
COPY packages/sandbox-manager/dist packages/sandbox-manager/dist
COPY packages/sandbox-manager-ui/dist packages/sandbox-manager-ui/dist
RUN pnpm --filter @nervekit/sandbox-manager deploy --prod --legacy /manager
RUN rm -rf /manager/dist/web && mkdir -p /manager/dist/web && cp -R packages/sandbox-manager-ui/dist/. /manager/dist/web/

FROM node:24-bookworm-slim
LABEL org.nerve.sandbox-manager.version="0.6.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates docker.io podman \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system sandbox-manager \
  && useradd --system --gid sandbox-manager --home-dir /home/sandbox-manager --create-home --shell /usr/sbin/nologin sandbox-manager \
  && mkdir -p /home/sandbox-manager/.nerve/sandbox-manager

COPY --from=manager-deps --chown=root:root /manager/ /manager/

ENV NODE_ENV=production
ENV NERVE_SANDBOX_MANAGER_HOST=0.0.0.0
ENV NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND=true
ENV NERVE_SANDBOX_MANAGER_SERVE_WEB_UI=1
WORKDIR /manager
USER sandbox-manager:sandbox-manager
EXPOSE 7869

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.NERVE_SANDBOX_MANAGER_PORT || 7869) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/manager/dist/main.js"]
