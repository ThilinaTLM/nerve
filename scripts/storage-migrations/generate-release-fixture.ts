#!/usr/bin/env tsx
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NERVE_HOME_MANIFEST } from "../../packages/contracts/src/domains/settings/home-configuration.js";
import { initializeHomeConfiguration } from "../../packages/workbench-server/src/infrastructure/configuration/home-configuration.js";
import { atomicWriteJson } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/json.js";
import { storagePaths } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/paths.js";
import { createFreshStorage } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/service.js";

export async function generateReleaseStorageFixture(
  repoRoot: string,
  version: string,
): Promise<string> {
  const fixtureRoot = resolve(
    repoRoot,
    "packages/workbench-server/test/fixtures/storage/releases",
    version,
  );
  const temporaryHome = await mkdtemp(
    resolve(tmpdir(), `nerve-release-${version}-`),
  );

  try {
    const paths = storagePaths(temporaryHome);
    await Promise.all([
      mkdir(paths.dataPath, { recursive: true, mode: 0o700 }),
      atomicWriteJson(paths.manifestPath, NERVE_HOME_MANIFEST, 0o600),
    ]);
    await initializeHomeConfiguration(paths);
    await createFreshStorage({
      paths,
      appVersion: version,
      buildId: `${version}:release-fixture`,
    });

    await mkdir(resolve(fixtureRoot, "data"), { recursive: true });
    await Promise.all([
      cp(paths.manifestPath, resolve(fixtureRoot, "manifest.json")),
      cp(paths.configPath, resolve(fixtureRoot, "config"), {
        recursive: true,
      }),
      cp(paths.sqlitePath, resolve(fixtureRoot, "data/nerve.sqlite")),
    ]);
    return fixtureRoot;
  } catch (error) {
    await rm(fixtureRoot, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [repoRoot, version] = process.argv.slice(2);
  if (!repoRoot || !version) {
    throw new Error(
      "Usage: generate-release-fixture.ts REPOSITORY_ROOT VERSION",
    );
  }
  const fixture = await generateReleaseStorageFixture(repoRoot, version);
  console.log(`Generated sanitized release storage fixture: ${fixture}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
