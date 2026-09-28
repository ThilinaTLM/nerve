#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: scripts/tag-release.sh X.Y.Z" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

version="$1"
release_tag="v${version}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this script from within a Git checkout." >&2
  exit 1
}

node --input-type=module - "${version}" "${script_dir}/lib/release-version.mjs" <<'NODE'
import { pathToFileURL } from "node:url";

const [version, modulePath] = process.argv.slice(2);
const { assertReleaseVersion } = await import(pathToFileURL(modulePath));
assertReleaseVersion(version);
NODE

cd "${repo_root}"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "The working tree must be clean before creating a release." >&2
  exit 1
fi

if ! current_branch="$(git symbolic-ref --quiet --short HEAD)"; then
  echo "A release must be created from a checked-out branch, not detached HEAD." >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/${release_tag}" >/dev/null; then
  echo "Tag ${release_tag} already exists locally." >&2
  exit 1
fi

if remote_tag="$(git ls-remote --exit-code --tags origin "refs/tags/${release_tag}")"; then
  echo "Tag ${release_tag} already exists on origin: ${remote_tag}" >&2
  exit 1
else
  remote_status=$?
  if [[ ${remote_status} -ne 2 ]]; then
    echo "Could not check origin for tag ${release_tag}." >&2
    exit "${remote_status}"
  fi
fi

migration_release_tool="${script_dir}/storage-migrations/release-lifecycle.mjs"
release_fixture="packages/workbench-server/test/fixtures/storage/releases/${version}"
node "${migration_release_tool}" check
if [[ ! -e "${release_fixture}" ]]; then
  pnpm --dir "${script_dir}/.." --filter @nervekit/contracts exec tsc -b --force
  pnpm --dir "${script_dir}/.." exec tsx \
    "${script_dir}/storage-migrations/generate-release-fixture.ts" \
    "${repo_root}" \
    "${version}"
fi
node "${migration_release_tool}" check-fixture "${version}"

node --input-type=module - \
  "${repo_root}" \
  "${version}" \
  "${script_dir}/lib/release-version.mjs" \
  "${script_dir}/lib/workspace-packages.mjs" \
  "${script_dir}/lib/discover-release.mjs" <<'NODE'
import { pathToFileURL } from "node:url";

const [
  repoRoot,
  version,
  releaseVersionPath,
  workspacePackagesPath,
  discoverReleasePath,
] = process.argv.slice(2);
const [
  { setWorkspaceVersion },
  { assertWorkspaceVersionsMatch },
  { stampPendingDiscoverRelease },
] = await Promise.all([
  import(pathToFileURL(releaseVersionPath)),
  import(pathToFileURL(workspacePackagesPath)),
  import(pathToFileURL(discoverReleasePath)),
]);

const changedPaths = await setWorkspaceVersion(repoRoot, version);
if (changedPaths.length === 0) {
  throw new Error(`Workspace manifests already use version ${version}.`);
}
await assertWorkspaceVersionsMatch(repoRoot);
const discover = await stampPendingDiscoverRelease(repoRoot, version);

console.log(`Updated workspace manifests to version ${version}:`);
for (const path of changedPaths) console.log(`  ${path}`);
if (discover.changedPath) {
  console.log(
    `Stamped ${discover.count} pending Discover announcement(s) in ${discover.changedPath}.`,
  );
}
NODE

node "${migration_release_tool}" stamp "${version}"

git add -- \
  package.json \
  packages/*/package.json \
  packages/workbench-app/src/lib/app/discover/content/news.ts \
  packages/native/native/Cargo.toml \
  packages/workbench-server/src/infrastructure/storage-migrations/migrations.lock.json \
  packages/workbench-server/src/infrastructure/storage-migrations/steps/registry-metadata.ts \
  "${release_fixture}" \
  Cargo.lock

if git diff --cached --quiet; then
  echo "No version changes were staged for ${release_tag}." >&2
  exit 1
fi

git commit -S -m "chore(release): bump version to ${release_tag}"

if ! git cat-file commit HEAD | grep -q '^gpgsig'; then
  echo "Release commit is not signed; refusing to create ${release_tag}." >&2
  exit 1
fi

git tag -a "${release_tag}" -m "Release ${release_tag}"

echo "Created ${release_tag} on branch ${current_branch}."
echo "The current branch has not been pushed."

push_tag=false
if [[ -t 0 && -t 1 ]]; then
  read -r -p "Push tag ${release_tag} to origin? [y/N] " reply
  case "${reply}" in
    y | Y | yes | YES | Yes) push_tag=true ;;
  esac
else
  echo "No interactive terminal is available; leaving the tag local."
fi

if [[ "${push_tag}" == true ]]; then
  git push origin "refs/tags/${release_tag}"
  echo "Pushed ${release_tag}; the Publish Release workflow will now start."
else
  echo "Tag not pushed. To publish it later, run:"
  echo "  git push origin refs/tags/${release_tag}"
fi
