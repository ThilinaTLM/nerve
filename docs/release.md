# Release checklist

Nerve publishes one npm package, `@nervekit/desktop`. The source implementation remains the private `@nervekit/desktop-shell` workspace; signed native installers are not part of this release path. Native-host filesystem and process requirements are documented in [Cross-platform reliability](architecture/cross-platform-reliability.md).

## Requirements

- Node.js 24+
- pnpm 11.20.0

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

## Release commit signing

The manual release workflow creates its version-bump commit on protected `main`, so it must use the dedicated `Nerve Release Bot` GPG key registered on the `ThilinaTLM` GitHub account. The initiating maintainer remains the commit author; `Nerve Release Bot <41065538+ThilinaTLM@users.noreply.github.com>` is the signing committer.

Configure these repository Actions secrets together:

- `RELEASE_GPG_PRIVATE_KEY`: the passphrase-protected armored private key
- `RELEASE_GPG_PASSPHRASE`: the private-key passphrase
- `RELEASE_GPG_FINGERPRINT`: the full primary-key fingerprint

The matching public key must remain registered with GitHub. The workflow imports the private key into an ephemeral keyring and fails before its atomic push if a secret is missing, the fingerprint differs, the key cannot be unlocked, or the release commit does not verify against that fingerprint.

The current automation key expires on 2028-08-10. Rotate it before expiry by generating and registering a replacement key, replacing all three secrets together, validating a release, and then removing the old public key. If the key may be compromised, remove it from GitHub and replace the secrets before another release.

## npm publication and OIDC

Tagged releases use GitHub OIDC trusted publishing with provenance and no stored npm token. The trusted publisher for `@nervekit/desktop` uses `.github/workflows/release.yml` in `ThilinaTLM/nerve`. The workflow must not publish until its configured checks, tools/desktop host tests, package verification, desktop packaging, and built-artifact smokes pass on Linux, Windows, and macOS. Workbench-server native host coverage is owned by the separate native-host workflow. An already-published matching version may be skipped only after the expected local tarball is verified.

After a release is published and clean-machine startup is verified, confirm npm `latest` points to it. Do not unpublish legacy packages or desktop versions: pinned older desktop installs may still require them.

## Scope and cleanup

The npm launcher supports Linux, Windows, and macOS. Signed/notarized app bundles and native installers remain explicit non-goals. Every smoke must use temporary homes and workspaces, random loopback ports, terminate child processes, and remove temporary install projects it promises to clean.
