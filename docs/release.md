# Release checklist

Nerve publishes one npm package, `@nervekit/desktop`. The source implementation remains the private `@nervekit/desktop-shell` workspace; signed native installers are not part of this release path. Native-host filesystem and process requirements are documented in [Cross-platform reliability](architecture/cross-platform-reliability.md).

## Requirements

- Node.js 24+
- pnpm 11.17.0

## Public npm package

Publish only `@nervekit/desktop`. Its generated tarball embeds the five private runtime workspaces `contracts`, `protocol`, `harness`, `tools`, and `workbench-server` as npm bundled dependencies. Third-party dependencies such as Electron and sharp remain normal dependencies so npm installs the correct platform artifacts.

All source workspaces are private. Workbench-server embeds the built workbench web assets.

## Version and validation

Keep the root and workspace versions aligned and tag `v<version>`.

```sh
pnpm install --frozen-lockfile
pnpm release:verify-tag -- v0.13.0
pnpm fix
pnpm check
pnpm test
pnpm build
node scripts/pack-npm.mjs
```

`release/npm` is generated and must not be committed. Packing creates a temporary `release/npm-stage/desktop` tree and removes it on completion. `node scripts/pack-npm.mjs` must produce only `release/npm/nervekit-desktop-<version>.tgz`; it verifies exact names, versions, contents, bundled package resolution, the workbench/worker entries, and the desktop launcher through an isolated install.

Run the finite built-artifact smokes after `pnpm build`:

```sh
pnpm release:verify-npm          # inspect packed tarballs and isolated install
pnpm release:smoke:workbench     # built workbench server HTTP/WS parity
pnpm release:smoke:desktop       # desktop --version/--help and server resolution
pnpm --filter @nervekit/desktop-shell package:dir
pnpm release:smoke:desktop-package
```

## State reset before testing an incompatible development store

Stop all Nerve processes first, then remove the complete `NERVE_HOME` (default `~/.nerve`). Its marker is `nerve-workbench-state` version 2. Clear browser site local and session storage when testing the browser workbench independently.

The deterministic workbench error is `Incompatible Nerve state at <path>...`, ending with `Reset this directory before starting Nerve Protocol v1.` The headless workbench has no general migration reader. The desktop has one narrow upgrade path for an unversioned legacy workbench home: after confirmation it retains a timestamped whole-home backup, initializes version 2, and restores only portable user state—validated settings, the custom provider/model catalog, and re-encrypted provider credentials. Malformed settings or catalog data aborts the migration and restores the original home; an undecryptable credential store is reported as a nonfatal failure because the backup retains it. Conversations, agents, projects, logs, plans, run history, SQLite, and daemon/session state remain only in the backup. Nerve never downgrades or automatically resets malformed, unknown, or future versioned stores.

## npm publication and OIDC

Tagged releases use GitHub OIDC trusted publishing with provenance and no stored npm token. The trusted publisher for `@nervekit/desktop` uses `.github/workflows/release.yml` in `ThilinaTLM/nerve`. The workflow must not publish until checks, host/desktop tests, package verification, and built-artifact smokes pass on the configured Linux, Windows, and macOS jobs. An already-published matching version may be skipped only after the expected local tarball is verified.

After a release is published and clean-machine startup is verified, confirm npm `latest` points to it. Do not unpublish legacy packages or desktop versions: pinned older desktop installs may still require them.

## Scope and cleanup

The npm launcher supports Linux, Windows, and macOS. Signed/notarized app bundles and native installers remain explicit non-goals. Every smoke must use temporary homes and workspaces, random loopback ports, terminate child processes, and remove temporary install projects it promises to clean.
