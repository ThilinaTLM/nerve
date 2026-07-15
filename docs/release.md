# Release checklist

Nerve publishes exactly one npm package, `@nervekit/desktop`, and builds two private runtime images. The source implementation remains the private `@nervekit/desktop-shell` workspace; signed native installers are not part of this release path.

## Requirements

- Node.js 24+
- pnpm 11.8.0
- Docker or Podman for the required image gate
- PostgreSQL for manager integration/image smoke

## Public npm package

Publish only `@nervekit/desktop`. Its generated tarball embeds the private `contracts`, `protocol`, `harness`, `tools`, `host-runtime`, and `workbench-server` runtime workspaces as npm bundled dependencies. Third-party dependencies such as Electron and sharp remain normal dependencies so npm installs the correct platform artifacts.

All source workspaces are private. Workbench-server embeds the built workbench web assets. Sandbox-manager embeds the manager web assets in its image rather than an npm publication.

## Version and validation

Keep the root and workspace versions aligned and tag `v<version>`.

```sh
pnpm install --frozen-lockfile
pnpm release:verify-tag -- v0.8.0
pnpm fix
pnpm check
pnpm test
pnpm build
pnpm release:build
node scripts/pack-npm.mjs
pnpm build-image:sandbox-agent
NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES=false pnpm build-image:sandbox-manager
```

`release/npm` is generated and must not be committed. Packing creates a temporary `release/npm-stage/desktop` tree and removes it on completion. `node scripts/pack-npm.mjs` must produce only `release/npm/nervekit-desktop-0.8.0.tgz`; it verifies exact names, versions, contents, bundled package resolution, the workbench/worker entries, and the desktop launcher through an isolated install.

Run the finite built-artifact and image smokes after `pnpm release:build`:

```sh
pnpm release:verify-npm            # inspect packed tarballs and isolated install
pnpm release:smoke:workbench       # built workbench server HTTP/WS parity
pnpm release:smoke:desktop         # desktop --version/--help and server resolution
pnpm release:smoke:sandbox         # manager UI + manager-agent replay/ACK/resume
pnpm release:smoke:image:sandbox-agent    # after build-image:sandbox-agent
pnpm release:smoke:image:sandbox-manager  # after build-image:sandbox-manager
```

The sandbox and manager-image smokes need PostgreSQL. They use `NERVE_TEST_POSTGRES_URL` when set and otherwise start a disposable `postgres:16-alpine` container through the selected `NERVE_CONTAINER_CLI`. `pnpm build-image:sandbox-agent` and `pnpm build-image:sandbox-manager` run their image smoke automatically after building.

Select a container runtime explicitly when needed:

```sh
NERVE_CONTAINER_CLI=docker pnpm build-image:sandbox-agent
NERVE_CONTAINER_CLI=podman pnpm build-image:sandbox-manager
```

## State reset before testing an incompatible development store

Stop all Nerve processes and containers first.

- Workbench: remove the complete `NERVE_HOME` (default `~/.nerve`). Its marker is `nerve-workbench-state` version 2.
- Sandbox daemon: recreate the complete `/state` volume. Its marker is `nerve-sandbox-agent-state` version 4.
- Sandbox manager: reset both its configured storage directory (`nerve-sandbox-manager-state` version 1) and its PostgreSQL database.
- Browsers: clear site local and session storage, including `nerve.protocol.clientId`, `nerve.protocol.instanceId`, and manager record `nerve.protocol.v1.sandbox-manager-ui` (epoch `protocol-v1`).

The deterministic errors are `Incompatible Nerve state at <path>...`, `Incompatible sandbox agent state at <path>...`, and `Incompatible sandbox manager state at <path>...`, each ending with `Reset this directory before starting Nerve Protocol v1.` No migration reader is provided.

## npm publication, migration, and OIDC

Tagged releases use GitHub OIDC trusted publishing with provenance and no stored npm token. The existing trusted publisher for `@nervekit/desktop` continues to use `.github/workflows/release.yml` in `ThilinaTLM/nerve`. The workflow must not publish until checks, tests, cross-platform package verification, Linux built-artifact smokes, manager-agent smoke, and both image smokes pass. An already-published matching version may be skipped only after the expected local tarball is verified.

After `@nervekit/desktop@0.8.0` is published and clean-machine startup is verified, confirm npm `latest` points to it. Then deprecate versions `<=0.7.0` of `@nervekit/shared`, `@nervekit/tools`, `@nervekit/agent`, and `@nervekit/orchestrator` with `Internal legacy package retained for @nervekit/desktop <=0.7.0. Install @nervekit/desktop@latest instead.` Deprecate `@nervekit/desktop@<=0.7.0` with `Legacy multi-package release. Upgrade to @nervekit/desktop@latest.` Do not unpublish these versions: pinned legacy desktop installs still need them.

## Scope and cleanup

The npm launcher supports Linux, Windows, and macOS. Signed/notarized app bundles and native installers remain explicit non-goals. Every smoke must use temporary homes/state/databases/workspaces and random loopback ports, terminate child processes/containers, and remove temporary install projects, volumes, and test images it promises to clean.
