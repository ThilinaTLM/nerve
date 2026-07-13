# Build from repository root after pnpm builds the manager and manager app.
FROM node:24-bookworm-slim AS manager-deps

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/dist packages/contracts/dist
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/protocol/dist packages/protocol/dist
COPY packages/sandbox-manager/package.json packages/sandbox-manager/package.json
COPY packages/sandbox-manager/migrations packages/sandbox-manager/migrations
COPY packages/sandbox-manager/dist packages/sandbox-manager/dist
COPY packages/sandbox-manager-app/dist packages/sandbox-manager-app/dist
RUN pnpm --filter @nervekit/sandbox-manager deploy --prod --legacy /manager
RUN rm -rf /manager/dist/web && mkdir -p /manager/dist/web && cp -R packages/sandbox-manager-app/dist/. /manager/dist/web/

FROM node:24-bookworm-slim
ARG INSTALL_LOCAL_RUNTIMES=true
ARG NERVE_VERSION
LABEL org.nerve.sandbox.spec="v1" \
  org.nerve.sandbox-manager.version="${NERVE_VERSION}"

RUN set -eux; \
  apt-get update; \
  packages="ca-certificates"; \
  if [ "${INSTALL_LOCAL_RUNTIMES}" = "true" ]; then packages="${packages} docker.io podman"; fi; \
  apt-get install -y --no-install-recommends ${packages}; \
  rm -rf /var/lib/apt/lists/*; \
  groupadd --system sandbox-manager \
  && useradd --system --gid sandbox-manager --home-dir /home/sandbox-manager --create-home --shell /usr/sbin/nologin sandbox-manager \
  && mkdir -p /home/sandbox-manager/.nerve/sandbox-manager \
  && chown -R sandbox-manager:sandbox-manager /home/sandbox-manager

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
