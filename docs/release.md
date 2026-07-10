# Release checklist

Nerve's public release path publishes selected `@nervekit/*` packages to npmjs.com. The desktop app is distributed as the runnable `@nervekit/desktop-shell` npm package.

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

- `@nervekit/contracts`
- `@nervekit/agent-tools`
- `@nervekit/agent-runtime`
- `@nervekit/orchestrator` — embeds the static Web UI for the desktop and daemon.
- `@nervekit/desktop-shell` — runnable via `npx` or `pnpm dlx`.

Private (never published):

- the root `nerve` monorepo package;
- `@nervekit/workbench-app` and `@nervekit/workbench-ui`;
- `@nervekit/sandbox-runtime`, `@nervekit/sandbox-manager`, and
  `@nervekit/sandbox-manager-app`.

## Local validation

```sh
pnpm install
pnpm fix
pnpm check
pnpm test
pnpm release:verify-tag -- v0.1.0
pnpm release:build
```

For npm package inspection:

```sh
node scripts/pack-npm.mjs
ls release/npm           # expect 5 tarballs
npm publish release/npm/*.tgz --dry-run --access public
```

Desktop launcher smoke test:

```sh
node packages/desktop-shell/dist/bin.js --version
node packages/desktop-shell/dist/bin.js --help
node packages/desktop-shell/dist/bin.js     # launches the desktop app
```

## Running the desktop app from npm

```sh
npx @nervekit/desktop-shell
pnpm dlx @nervekit/desktop-shell
```

Notes:

- The npm/unpackaged desktop launcher can run on Linux, Windows, and macOS.
- The `electron` npm dependency downloads the platform binary on first install/run
  (~100–200 MB), then it is cached by npm or pnpm.
- This is an unpackaged Electron launch, not a signed app bundle or native
  installer.
- Release packaging currently targets Linux only. Signed/notarized macOS `.app`
  or DMG packaging is future work and is not required for source development or
  the npm launcher.

## First public release: npm bootstrap

npm Trusted Publishing (OIDC) cannot publish a package that does not yet exist,
so the very first `@nervekit/*` publish is done manually. One time only:

1. Create the `nervekit` npm organization/scope and confirm the package names are
   available.
2. Enable 2FA on the publishing npm account.
3. Run full local validation and pack the tarballs:

   ```sh
   pnpm release:build
   node scripts/pack-npm.mjs
   ls release/npm           # expect 5 tarballs
   ```

4. Publish the five tarballs in dependency-friendly order:

   ```sh
   for pkg in contracts agent-tools agent-runtime orchestrator desktop-shell; do
     npm publish release/npm/nervekit-${pkg}-0.1.0.tgz --access public
   done
   ```

5. On npmjs.com, configure a Trusted Publisher for each of the five packages:
   - Publisher: GitHub Actions
   - Organization/user: `ThilinaTLM`
   - Repository: `nerve`
   - Workflow filename: `release.yml`
   - Allowed action: `npm publish`

6. Tag and push `v0.1.0` (see below). The release workflow skips package versions
   that are already published, so re-publishing the bootstrapped `0.1.0` is a no-op.

## GitHub Actions release automation

Pushing a tag matching `v*` runs `.github/workflows/release.yml`.

The workflow:

1. uses Node 24 and pnpm 11.8.0;
2. verifies the tag matches the package version;
3. runs `pnpm check` and `pnpm test`;
4. runs a cross-platform npm/bin smoke job on Linux, Windows, and macOS;
5. publishes any unpublished `@nervekit/*` versions to npmjs.com via npm
   Trusted Publishing (OIDC) with provenance (no stored npm token).

Create a release by pushing the tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Subsequent releases

1. Bump the root and all workspace versions consistently.
2. Run local validation.
3. Push the matching `vX.Y.Z` tag.
4. CI publishes the new package versions via OIDC. No manual npm publish is needed once Trusted Publishers are configured.
