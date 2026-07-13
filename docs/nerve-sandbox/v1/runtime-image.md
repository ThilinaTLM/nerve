# Runtime images

## Sandbox agent

`packages/sandbox-agent/Dockerfile` builds from the repository root and deploys production dependencies to `/agent`. It includes Node 24, pnpm/yarn, Python/uv, Java, Git/Git LFS, compilers, and common coding utilities. OCI labels include `org.nerve.sandbox.spec=v1` and the Nerve version.

The image runs as `sandbox:sandbox`, works in `/workspace`, and starts `node /agent/dist/main.js`. Health executes the built `healthcheck` command. `/agent` is root-owned and non-writable; `/workspace` and persistent `/state` must be writable by the configured UID/GID.

## Sandbox manager

`packages/sandbox-manager/Dockerfile` deploys the manager, migrations, and bundled manager-app `dist/web`, exposes 7869, runs non-root, and health-checks `/health`. `INSTALL_LOCAL_RUNTIMES=false` omits Docker/Podman clients for ECS/portable CI; local-runtime images may include them.

Build with `pnpm build-image:sandbox-agent` and `pnpm build-image:sandbox-manager`. Set `NERVE_CONTAINER_CLI` to select Docker or Podman deterministically and image env vars to override development tags.
