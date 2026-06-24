# Release checklist

Nerve's public release path ships Linux desktop artifacts on GitHub Releases plus
all `@nervekit/*` packages on npmjs.com. The first public release is `v0.1.0`.

## Requirements

- Node.js 24 (the workspace `engines.node` is `>=24.0.0`).
- pnpm 11.8.0.

## Versioning

1. Update the root and workspace package versions together.
2. Use a matching Git tag: `v<package version>`; for example, `v0.1.0`.
3. Verify locally before pushing:

```sh
pnpm release:verify-tag -- v0.1.0
```

## Packages

Published publicly to npmjs.com under the `@nervekit` scope:

- `@nervekit/shared`
- `@nervekit/tools`
- `@nervekit/agent`
- `@nervekit/web` — static web UI assets (no CLI/bin); the desktop and daemon
  serve the web UI through `@nervekit/orchestrator`, which embeds its own copy.
- `@nervekit/orchestrator`
- `@nervekit/cli`
- `@nervekit/desktop` — runnable via `npx`/`pnpx` (see below).

Private (never published):

- the root `nerve` monorepo package.

## Local validation

```sh
pnpm install
pnpm check
pnpm lint
pnpm test
pnpm release:verify-tag -- v0.1.0
pnpm release:build
```

For npm package inspection:

```sh
pnpm release:pack:npm
ls release/npm           # expect 7 tarballs
npm publish release/npm/*.tgz --dry-run --access public
```

Desktop launcher smoke test:

```sh
node packages/desktop/dist/bin.js --version
node packages/desktop/dist/bin.js --help
node packages/desktop/dist/bin.js     # launches the desktop app
```

For Linux desktop artifacts, make sure local packaging tools such as `fakeroot` and `rpm`/`rpmbuild` are available, then run:

```sh
pnpm release:desktop:linux
ls packages/desktop/release
cat packages/desktop/release/SHA256SUMS
```

Smoke-test the AppImage/deb/rpm before announcing a release. At minimum verify that the desktop app starts an owned local daemon, loads the Web UI, and stops its owned daemon when quitting.

## Running the desktop app via npx

```sh
npx @nervekit/desktop
pnpx @nervekit/desktop
```

Notes:

- Works on Linux, Windows, and macOS.
- The `electron` npm dependency downloads the platform binary on first install/run
  (~100–200 MB), then it is cached by npm/pnpm.
- This is an unpackaged Electron launch, not a signed macOS `.app`, Windows
  installer, or Linux AppImage. Native installers remain GitHub Release artifacts
  (Linux today; macOS/Windows installers are future work).

## First public release: npm bootstrap

npm Trusted Publishing (OIDC) cannot publish a package that does not yet exist,
so the very first `@nervekit/*` publish is done manually. One time only:

1. Create the `nervekit` npm organization/scope and confirm the package names are
   available.
2. Enable 2FA on the publishing npm account.
3. Run full local validation and pack the tarballs:

   ```sh
   pnpm release:pack:npm
   ls release/npm           # expect 7 tarballs
   ```

4. Publish the seven tarballs in dependency-friendly order:

   ```sh
   for pkg in shared tools agent web orchestrator cli desktop; do
     npm publish release/npm/nervekit-${pkg}-0.1.0.tgz --access public
   done
   ```

5. On npmjs.com, configure a Trusted Publisher for each of the seven packages:
   - Publisher: GitHub Actions
   - Organization/user: `ThilinaTLM`
   - Repository: `nerve`
   - Workflow filename: `release.yml`
   - Allowed action: `npm publish`

6. Tag and push `v0.1.0` (see below). The release workflow skips package versions
   that are already published, so re-publishing the bootstrapped `0.1.0` is a no-op.

## GitHub release automation

Pushing a tag matching `v*` runs `.github/workflows/release.yml`.

The workflow:

1. uses Node 24 and pnpm 11.8.0;
2. verifies the tag matches the package version;
3. runs `pnpm check` and `pnpm test`;
4. builds Linux AppImage, deb, and rpm artifacts and writes `SHA256SUMS`;
5. runs a cross-platform npm/bin smoke job on Linux, Windows, and macOS;
6. publishes any unpublished `@nervekit/*` versions to npmjs.com via npm
   Trusted Publishing (OIDC) with provenance (no stored npm token);
7. creates the GitHub Release and uploads the Linux artifacts and checksums.

Create a release by pushing the tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Do not pre-create the GitHub Release; the workflow creates it after the build succeeds.

## Subsequent releases

1. Bump the root and all workspace versions consistently.
2. Run local validation.
3. Push the matching `vX.Y.Z` tag.
4. CI publishes the new package versions via OIDC and creates the GitHub Release.
   No manual npm publish is needed once Trusted Publishers are configured.

## Future Windows packaging

Add a separate `build-windows` job to the release workflow and include it in the `publish` job's `needs` list. That keeps Linux and Windows artifacts attached to the same tag-created GitHub Release.
