# Release checklist

> **Scope:** Maintainer procedure. The release workflows and release scripts are authoritative when this document differs.

Nerve publishes one npm package, `@nervekit/desktop`. The source implementation remains the private `@nervekit/desktop-shell` workspace; signed native installers are not part of this release path. Native-host filesystem and process requirements are documented in the public [Platform reliability](https://nerve.tlmtech.dev/developers/platform-reliability/) guide.

## Requirements

- Node.js 24+
- pnpm 11.20.0
- rustup with the pinned toolchain from `rust-toolchain.toml` (currently Rust 1.97.1)

## Public npm package

Publish only `@nervekit/desktop`. Its generated tarball embeds the six private runtime workspaces `contracts`, `native`, `protocol`, `harness`, `tools`, and `workbench-server` as npm bundled dependencies. Third-party dependencies such as Electron and sharp remain normal dependencies so npm installs the correct platform artifacts.

All source workspaces are private. Workbench-server embeds the built workbench web assets.

## Version and validation

Keep the root and workspace versions aligned and tag `v<version>`.

```sh
release_tag=vX.Y.Z
pnpm install --frozen-lockfile
node scripts/verify-release-tag.mjs "$release_tag"
pnpm fix
pnpm check
pnpm run test:full
pnpm build
node scripts/pack-npm.mjs
```

`release/npm` is generated and must not be committed. Packing creates a temporary `release/npm-stage/desktop` tree and removes it on completion. Final packing requires the exact six-file native prebuild inventory in `packages/native/prebuilds`; `node scripts/verify-native-prebuilds.mjs` rejects missing, extra, or developer-local artifacts. The release workflow produces this inventory. Ordinary local development needs only the host binding under `packages/native/prebuilds/local` and does not produce a publishable package.

`node scripts/pack-npm.mjs` must produce only `release/npm/nervekit-desktop-<version>.tgz`; it verifies exact names, versions, contents, bundled package resolution, package entrypoints, native prebuilds, and the desktop launcher through an isolated install.

Run the finite built-artifact smokes after `pnpm build`:

```sh
node scripts/verify-npm-tarballs.mjs       # inspect packed tarballs and isolated install
node scripts/smoke-workbench-release.mjs   # built workbench server HTTP/WS parity
node scripts/smoke-desktop-release.mjs     # desktop --version/--help and server resolution
pnpm --filter @nervekit/desktop-shell package:dir
node scripts/smoke-desktop-package.mjs
```

## Automated release flow

Run the **Tag Release** workflow manually with the exact version to publish. It updates all workspace versions on protected `main`, creates the signed release commit and annotated `v<version>` tag, atomically pushes both refs, and emits the internal `release-tagged` event for that immutable tag.

The **Publish Release** workflow responds to that event, validates the tag, and builds the native runtime on architecture-matched runners for Linux x64/ARM64, Windows 11 x64/ARM64, macOS Intel, and macOS Apple Silicon. Every runner executes the generated addon before the artifacts are merged. Representative Linux, Windows, and macOS jobs then run the complete quality and Electron package smokes against the merged inventory. The workflow builds and deploys the website to GitHub Pages, publishes to npm through OIDC, and creates the GitHub release. Website deployment occurs only after release validation and npm publication. Direct pushes of matching SemVer tags also start Publish Release automatically.

If Tag Release pushes the commit and tag but emitting the event fails, re-emit it for the existing immutable tag. Do not recreate or move the tag:

```sh
gh api --method POST "repos/ThilinaTLM/nerve/dispatches" --input - <<'EOF'
{
  "event_type": "release-tagged",
  "client_payload": { "tag": "vX.Y.Z" }
}
EOF
```

## Storage and migration testing

Never validate a release or migration against the live home. Stop related Nerve processes, copy the source home to an isolated directory under `/tmp`, set an explicit `NERVE_HOME`, use explicit non-default ports, and give Electron a separate `userData` profile when desktop browser state must also be isolated.

Current homes use `manifest.json` with format `nerve-home`, version `1`. The only supported legacy import is the explicit offline migration from the released `nerve-workbench-state` version `2` layout with its checksummed ledger through `0012-remove-workers`. Unknown, malformed, intermediate-development, and future homes fail closed and remain untouched. See [Storage, cleanup, and migration](https://nerve.tlmtech.dev/operations/storage-migration/) and the repository [storage architecture](../architecture/storage.md).

## Release commit signing

The manually dispatched **Tag Release** workflow creates its version-bump commit on protected `main`, so it must use the dedicated `Nerve Release Bot` GPG key registered on the `ThilinaTLM` GitHub account. The initiating maintainer remains the commit author; `Nerve Release Bot <41065538+ThilinaTLM@users.noreply.github.com>` is the signing committer.

Configure these repository Actions secrets together:

- `RELEASE_GPG_PRIVATE_KEY`: the passphrase-protected armored private key
- `RELEASE_GPG_PASSPHRASE`: the private-key passphrase
- `RELEASE_GPG_FINGERPRINT`: the full primary-key fingerprint

The matching public key must remain registered with GitHub. Tag Release imports the private key into an ephemeral keyring and fails before its atomic push if a secret is missing, the fingerprint differs, the key cannot be unlocked, or the release commit does not verify against that fingerprint.

The current automation key expires on 2028-08-10. Rotate it before expiry by generating and registering a replacement key, replacing all three secrets together, validating a release, and then removing the old public key. If the key may be compromised, remove it from GitHub and replace the secrets before another release.

## npm publication and OIDC

Tagged releases use GitHub OIDC trusted publishing with provenance and no stored npm token. The trusted publisher for `@nervekit/desktop` uses `.github/workflows/release.yml` in `ThilinaTLM/nerve`. The workflow must not publish until its configured checks, tools/desktop host tests, package verification, desktop packaging, and built-artifact smokes pass on Linux, Windows, and macOS. Workbench-server native host coverage is owned by the separate native-host workflow. An already-published matching version may be skipped only after the expected local tarball is verified.

After a release is published and clean-machine startup is verified, confirm npm `latest` points to it. Do not unpublish legacy packages or desktop versions: pinned older desktop installs may still require them.

## Scope and cleanup

The npm launcher supports Linux, Windows, and macOS. Signed/notarized app bundles and native installers remain explicit non-goals. Every smoke must use temporary homes and workspaces, random loopback ports, terminate child processes, and remove temporary install projects it promises to clean.
