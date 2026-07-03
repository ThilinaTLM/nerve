# Sandbox v1 scaffold image. Build from the repository root after running package builds.
FROM node:24-bookworm-slim AS agent-deps

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/dist packages/shared/dist
COPY packages/agent/package.json packages/agent/package.json
COPY packages/agent/dist packages/agent/dist
COPY packages/tools/package.json packages/tools/package.json
COPY packages/tools/dist packages/tools/dist
COPY packages/sandbox-image/package.json packages/sandbox-image/package.json
COPY packages/sandbox-image/dist packages/sandbox-image/dist
RUN pnpm --filter @nervekit/sandbox-image deploy --prod --legacy /agent

FROM node:24-bookworm-slim
LABEL org.nerve.sandbox.spec="v1" \
  org.nerve.sandbox.runtime.version="0.6.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system sandbox \
  && useradd --system --gid sandbox --home-dir /home/sandbox --create-home --shell /usr/sbin/nologin sandbox \
  && mkdir -p /agent /agent/skills /workspace /state /tmp /secrets /credentials

COPY --from=agent-deps --chown=root:root /agent/ /agent/

RUN mkdir -p /agent/skills \
  && chown -R root:root /agent \
  && chmod -R a+rX,go-w /agent \
  && chown -R sandbox:sandbox /workspace /state /tmp /credentials /home/sandbox \
  && chmod 0555 /agent /agent/skills \
  && chmod 0700 /state /credentials

ENV NODE_ENV=production
ENV NERVE_SANDBOX_CONFIG=/etc/nerve/sandbox.yaml
USER sandbox:sandbox
WORKDIR /workspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node /agent/dist/main.js healthcheck >/dev/null || exit 1

ENTRYPOINT ["node", "/agent/dist/main.js"]
