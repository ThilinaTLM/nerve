# Release checklist

Nerve's first release path is Linux desktop artifacts plus npm CLI/daemon packages.

## Versioning

1. Update the root and workspace package versions together.
2. Use a matching Git tag: `v<package version>`; for example, `v0.1.0-alpha.1`.
3. Verify locally before pushing:

```sh
pnpm release:verify-tag -- v0.1.0-alpha.1
```

## Local validation

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm release:build
```

For npm package inspection:

```sh
pnpm release:pack:npm
ls release/npm
```

For Linux desktop artifacts, make sure local packaging tools such as `fakeroot` and `rpm`/`rpmbuild` are available, then run:

```sh
pnpm release:desktop:linux
ls packages/desktop/release
cat packages/desktop/release/SHA256SUMS
```

Smoke-test the AppImage/deb/rpm before announcing a release. At minimum verify that the desktop app starts an owned local daemon, loads the Web UI, and stops its owned daemon when quitting.

## GitHub release automation

Pushing a tag matching `v*` runs `.github/workflows/release.yml`.

The workflow:

1. installs Node 22.19.0 and pnpm 11.3.0;
2. verifies the tag matches the package version;
3. runs `pnpm check` and `pnpm test`;
4. builds Linux AppImage, deb, and rpm artifacts;
5. writes `SHA256SUMS`;
6. creates the GitHub Release after successful builds;
7. uploads the Linux artifacts and checksums.

Create a release by pushing the tag:

```sh
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

Do not pre-create the GitHub Release; the workflow creates it after the build succeeds.

## npm publish

The publishable packages are:

- `@nerve/shared`
- `@nerve/tools`
- `@nerve/agent`
- `@nerve/orchestrator`
- `@nerve/cli`

Use `pnpm release:pack:npm` first and inspect the generated tarballs. When ready, publish the inspected tarballs with public access for scoped packages:

```sh
for tarball in release/npm/*.tgz; do
  npm publish "$tarball" --access public
done
```

## Future Windows packaging

Add a separate `build-windows` job to the release workflow and include it in the `publish` job's `needs` list. That keeps Linux and Windows artifacts attached to the same tag-created GitHub Release.
