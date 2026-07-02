# Sandbox v1 scaffold image. Build from the repository root after running package builds.
FROM node:24-bookworm-slim
LABEL org.nerve.sandbox.spec="v1" \
  org.nerve.sandbox.runtime.version="0.6.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system sandbox \
  && useradd --system --gid sandbox --home-dir /home/sandbox --create-home --shell /usr/sbin/nologin sandbox \
  && mkdir -p /agent /agent/skills /workspace /state /tmp /secrets /credentials \
  && chown -R sandbox:sandbox /workspace /state /tmp /credentials /home/sandbox \
  && chmod 0555 /agent /agent/skills \
  && chmod 0700 /state /credentials

WORKDIR /agent
RUN npm install --omit=dev --no-package-lock yaml@2.9.0 ws@8.18.3
COPY packages/shared/dist /agent/node_modules/@nervekit/shared/dist
COPY packages/shared/package.json /agent/node_modules/@nervekit/shared/package.json
COPY packages/agent/dist /agent/node_modules/@nervekit/agent/dist
COPY packages/agent/package.json /agent/node_modules/@nervekit/agent/package.json
COPY packages/tools/dist /agent/node_modules/@nervekit/tools/dist
COPY packages/tools/package.json /agent/node_modules/@nervekit/tools/package.json
COPY packages/sandbox-image/dist /agent/dist
COPY packages/sandbox-image/package.json /agent/package.json

ENV NODE_ENV=production
ENV NERVE_SANDBOX_CONFIG=/etc/nerve/sandbox.yaml
USER sandbox:sandbox
WORKDIR /workspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node /agent/dist/main.js healthcheck >/dev/null || exit 1

ENTRYPOINT ["node", "/agent/dist/main.js"]
