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
node scripts/release/verify-release-tag.ts "$release_tag"
pnpm fix
pnpm check
pnpm run test:full
pnpm build
node scripts/release/pack-npm.ts
```

`release/npm` is generated and must not be committed. Packing creates a temporary `release/npm-stage/desktop` tree and removes it on completion. Final packing requires the exact six-file native prebuild inventory in `packages/native/prebuilds`; `node scripts/release/verify-native-prebuilds.ts` rejects missing, extra, or developer-local artifacts. The release workflow produces this inventory. Ordinary local development needs only the host binding under `packages/native/prebuilds/local` and does not produce a publishable package.

`node scripts/release/pack-npm.ts` must produce only `release/npm/nervekit-desktop-<version>.tgz`; it verifies exact names, versions, contents, bundled package resolution, package entrypoints, native prebuilds, and the desktop launcher through an isolated install.

Run the finite built-artifact smokes after `pnpm build`:

```sh
node scripts/release/verify-npm-tarballs.ts       # inspect packed tarballs and isolated install
node scripts/release/smoke-workbench-release.ts   # built workbench server HTTP/WS parity
node scripts/release/smoke-desktop-release.ts     # desktop --version/--help and server resolution
node scripts/release/smoke-desktop-package.ts
```

## Release dry run

Before creating a release tag, push the candidate branch and select **Actions → Publish Release → Run workflow**, then choose that branch. Manual runs are always dry runs; there is no publish option. With GitHub CLI:

```sh
gh workflow run release.yml --ref <candidate-branch>
```

The workflow must be present on the default branch for manual dispatch to be available. Each run checks out the selected commit SHA across all jobs, derives a candidate tag from the root package version, and verifies workspace versions without creating a Git tag. It runs the same six-platform native builds/tests, full quality/test suite, package and desktop smokes, npm tarball verification, and website checks/build as a tagged release. Native prebuilds, the verified npm tarball, and the website build remain workflow artifacts for inspection.

Manual runs skip npm publication, website deployment, and GitHub release creation. They cannot validate publishing credentials or deployment itself. A passing dry run does not publish anything; the normal tag-push flow below remains required.

## Release tagging flow

Start from a clean, up-to-date `main` (local `main` must equal `origin/main`) with a local Git identity and commit-signing key configured. Preview, then run, the release with the exact version to publish, without a leading `v`:

```sh
pnpm release:tag X.Y.Z --dry-run   # checks preconditions and prints the plan; changes nothing
pnpm release:tag X.Y.Z             # asks before pushing; --yes pushes without asking
```

The script (`scripts/release/tag-release.ts`) refuses to run on another branch, with local changes, when `main` differs from `origin/main`, or when the tag already exists locally or on origin. It then:

1. updates every workspace `package.json`, the native `Cargo.toml` and the `nerve-native` entry in `Cargo.lock`, and stamps Discover announcements authored with `releasedIn: "next"`;
2. marks every draft migration step released in this version (`stage: "released"`, `releasedIn`) in `migrations.lock.json` and `registry-metadata.ts`, records the step folder hash as its checksum (a drifted draft label is kept in `previousChecksums` so homes that applied the draft stay admitted), drops `rerunOnChange`, and runs the migration lock check;
3. creates the signed `chore(release): bump version to vX.Y.Z` commit and the annotated `vX.Y.Z` tag;
4. pushes `main` and the tag to origin in one atomic push.

After the release, the next storage change starts a new draft step. Pushing the tag immediately starts the **Publish Release** workflow, so confirm only when the commit is ready to publish. If the push is declined or no interactive terminal is available, publish later with `git push --atomic origin main refs/tags/vX.Y.Z`. The `main` ruleset requires signed commits and linear history; the release commit satisfies both.

The authenticated SemVer tag push starts the **Publish Release** workflow. It validates the tag and builds the native runtime on architecture-matched runners for Linux x64/ARM64, Windows 11 x64/ARM64, macOS Intel, and macOS Apple Silicon. Every runner executes the generated addon before the artifacts are merged. Representative Linux, Windows, and macOS jobs then run the complete quality and Electron package smokes against the merged inventory. The workflow builds and deploys the website to GitHub Pages, publishes to npm through OIDC, and creates the GitHub release. Website deployment occurs only after release validation and npm publication.

If publication fails after the immutable tag has started Publish Release, use GitHub Actions to re-run the failed jobs or the complete existing run. Do not recreate or move the tag.

## Storage and migration testing

Never validate a release or migration against the live home. Stop related Nerve processes, copy the source home to an isolated directory under `/tmp`, set an explicit `NERVE_HOME`, use explicit non-default ports, and give Electron a separate `userData` profile when desktop browser state must also be isolated.

Current homes use `manifest.json` with format `nerve-home`, version `1`. The only supported legacy import is the explicit offline migration from the released `nerve-workbench-state` version `2` layout with its checksummed ledger through `0012-remove-workers`. Unknown, malformed, intermediate-development, and future homes fail closed and remain untouched. See [Storage, cleanup, and migration](https://nerve.tlmtech.dev/operations/storage-migration/) and the repository [storage architecture](../architecture/storage.md).

## Release commit signing

`pnpm release:tag` uses `git commit -S` and refuses to create the tag unless Git records a signature on the release commit. Each maintainer must configure a local Git identity and a signing key whose public identity GitHub recognizes. The script does not read private signing material from repository secrets.

If any step fails before the commit exists (including signing), the script restores the working tree, so fix the cause and rerun it.

## npm publication and OIDC

Tagged releases use GitHub OIDC trusted publishing with provenance and no stored npm token. The trusted publisher for `@nervekit/desktop` uses `.github/workflows/release.yml` in `ThilinaTLM/nerve`. The workflow must not publish until its configured checks, tools/desktop host tests, package verification, desktop packaging, and built-artifact smokes pass on Linux, Windows, and macOS. Workbench-server native host coverage is owned by the separate native-host workflow. An already-published matching version may be skipped only after the expected local tarball is verified.

After a release is published and clean-machine startup is verified, confirm npm `latest` points to it. Do not unpublish legacy packages or desktop versions: pinned older desktop installs may still require them.

## Scope and cleanup

The npm launcher supports Linux, Windows, and macOS. Signed/notarized app bundles and native installers remain explicit non-goals. Every smoke must use temporary homes and workspaces, random loopback ports, terminate child processes, and remove temporary install projects it promises to clean.
