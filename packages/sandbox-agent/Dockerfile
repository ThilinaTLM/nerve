# Sandbox agent v1 scaffold image. Build from the repository root after running package builds.
FROM node:24-bookworm-slim AS agent-deps
ARG PNPM_VERSION=11.8.0

WORKDIR /repo
RUN npm install --global "pnpm@${PNPM_VERSION}" && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/dist packages/contracts/dist
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/protocol/dist packages/protocol/dist
COPY packages/harness/package.json packages/harness/package.json
COPY packages/harness/dist packages/harness/dist
COPY packages/tools/package.json packages/tools/package.json
COPY packages/tools/dist packages/tools/dist
COPY packages/host-runtime/package.json packages/host-runtime/package.json
COPY packages/host-runtime/dist packages/host-runtime/dist
COPY packages/sandbox-agent/package.json packages/sandbox-agent/package.json
COPY packages/sandbox-agent/dist packages/sandbox-agent/dist
RUN pnpm --filter @nervekit/sandbox-agent deploy --prod --legacy /agent

FROM node:24-bookworm-slim
ARG PNPM_VERSION=11.8.0
ARG YARN_VERSION=1.22.22
ARG UV_VERSION=0.11.27
ARG NVM_VERSION=v0.40.5
ARG SANDBOX_UID=10001
ARG SANDBOX_GID=10001
ARG NERVE_VERSION

LABEL org.nerve.sandbox.spec="v1" \
  org.nerve.sandbox.agent.version="${NERVE_VERSION}"

ENV HOME=/home/sandbox \
  NVM_DIR=/home/sandbox/.nvm \
  PNPM_HOME=/state/cache/dependencies/pnpm \
  NPM_CONFIG_PREFIX=/state/cache/dependencies/npm-global \
  NPM_CONFIG_CACHE=/state/cache/dependencies/npm \
  YARN_CACHE_FOLDER=/state/cache/dependencies/yarn \
  XDG_CACHE_HOME=/state/cache
ENV PATH=/state/cache/dependencies/npm-global/bin:/state/cache/dependencies/pnpm:/home/sandbox/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    autoconf \
    automake \
    bash \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    default-jdk-headless \
    dnsutils \
    file \
    git \
    git-lfs \
    gnupg \
    gpg-agent \
    iproute2 \
    iputils-ping \
    jq \
    less \
    libtool \
    make \
    netcat-openbsd \
    ninja-build \
    openssh-client \
    pipx \
    pkg-config \
    procps \
    python-is-python3 \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    ripgrep \
    rsync \
    shellcheck \
    sqlite3 \
    tree \
    unzip \
    wget \
    xz-utils \
    zip; \
  rm -rf /var/lib/apt/lists/*; \
  groupadd --system --gid "${SANDBOX_GID}" sandbox; \
  useradd --system --uid "${SANDBOX_UID}" --gid sandbox --home-dir /home/sandbox --create-home --shell /usr/sbin/nologin sandbox; \
  mkdir -p \
    /agent \
    /agent/skills \
    /workspace \
    /state/cache \
    /state/cache/dependencies \
    "${PNPM_HOME}" \
    "${NPM_CONFIG_PREFIX}" \
    "${NPM_CONFIG_CACHE}" \
    "${YARN_CACHE_FOLDER}" \
    /tmp \
    /secrets \
    /credentials \
    "${NVM_DIR}" \
    /home/sandbox/.local/share/pnpm \
    /home/sandbox/.local \
    /home/sandbox/.cache \
    /home/sandbox/.config

RUN set -eux; \
  NPM_CONFIG_PREFIX=/home/sandbox/.local npm install --global "pnpm@${PNPM_VERSION}" "yarn@${YARN_VERSION}"; \
  npm cache clean --force

RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "${arch}" in \
    amd64) uv_target="x86_64-unknown-linux-gnu" ;; \
    arm64) uv_target="aarch64-unknown-linux-gnu" ;; \
    *) echo "Unsupported architecture for uv: ${arch}" >&2; exit 1 ;; \
  esac; \
  tmp="$(mktemp -d)"; \
  cd "${tmp}"; \
  curl -fsSLO "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uv_target}.tar.gz"; \
  curl -fsSLO "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/sha256.sum"; \
  grep "uv-${uv_target}.tar.gz" sha256.sum | sha256sum -c -; \
  mkdir uv-bin; \
  tar -xzf "uv-${uv_target}.tar.gz" -C uv-bin --strip-components=1 "uv-${uv_target}/uv" "uv-${uv_target}/uvx"; \
  install -m 0755 uv-bin/uv uv-bin/uvx /usr/local/bin/; \
  cd /; \
  rm -rf "${tmp}"

RUN set -eux; \
  git clone --depth 1 --branch "${NVM_VERSION}" https://github.com/nvm-sh/nvm.git "${NVM_DIR}"; \
  printf '%s\n' \
    'export NVM_DIR="${NVM_DIR:-/home/sandbox/.nvm}"' \
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' \
    > /etc/profile.d/nvm.sh; \
  chmod 0644 /etc/profile.d/nvm.sh; \
  for profile in /home/sandbox/.profile /home/sandbox/.bashrc; do \
    printf '\n%s\n%s\n' \
      'export NVM_DIR="${NVM_DIR:-/home/sandbox/.nvm}"' \
      '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' \
      >> "${profile}"; \
  done

COPY --from=agent-deps --chown=root:root /agent/ /agent/

RUN set -eux; \
  mkdir -p /agent/skills; \
  chown -R root:root /agent; \
  chmod -R a+rX,go-w /agent; \
  chown -R sandbox:sandbox /workspace /state /tmp /credentials /home/sandbox; \
  chmod 0555 /agent /agent/skills; \
  chmod 0700 /state /credentials

RUN set -eux; \
  node --version; \
  npm --version; \
  pnpm --version; \
  yarn --version; \
  python --version; \
  python3 -m venv /tmp/toolchain-venv; \
  uv --version; \
  uvx --version; \
  java -version; \
  javac -version; \
  gcc --version; \
  g++ --version; \
  make --version; \
  cmake --version; \
  ninja --version; \
  pkg-config --version; \
  git --version; \
  git lfs version; \
  jq --version; \
  rg --version; \
  shellcheck --version; \
  bash -lc 'source "${NVM_DIR}/nvm.sh" && nvm --version'; \
  rm -rf /tmp/toolchain-venv

ENV NODE_ENV=production
ENV NERVE_SANDBOX_AGENT_CONFIG=/etc/nerve/sandbox.yaml
USER sandbox:sandbox
WORKDIR /workspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node /agent/dist/main.js healthcheck >/dev/null || exit 1

ENTRYPOINT ["node", "/agent/dist/main.js"]
