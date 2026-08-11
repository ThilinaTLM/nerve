import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertReleaseVersion,
  setWorkspaceVersion,
} from "./release-version.mjs";

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-release-version-"));
  await mkdir(join(root, "packages", "alpha"), { recursive: true });
  await mkdir(join(root, "packages", "website"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "root", version: "1.0.0", private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "packages", "alpha", "package.json"),
    `${JSON.stringify({ name: "alpha", version: "1.0.0", marker: "kept" }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "packages", "website", "package.json"),
    `${JSON.stringify({ name: "website", version: "0.9.0" }, null, 2)}\n`,
  );
  return root;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("accepts stable and prerelease versions", () => {
  for (const version of ["0.23.0", "1.2.3-rc.1", "10.0.0-beta-feature.2"]) {
    assert.equal(assertReleaseVersion(version), version);
  }
});

test("rejects non-canonical or unsupported versions", () => {
  for (const version of [
    "v1.2.3",
    "1.2",
    "01.2.3",
    "1.2.3-rc.01",
    "1.2.3+build.1",
    "1.2.3-",
  ]) {
    assert.throws(
      () => assertReleaseVersion(version),
      /Invalid release version/,
    );
  }
});

test("updates the root and every package manifest", async (context) => {
  const root = await createFixture();
  context.after(() => rm(root, { recursive: true, force: true }));

  const changedPaths = await setWorkspaceVersion(root, "1.1.0-rc.1");
  assert.deepEqual(changedPaths, [
    "package.json",
    join("packages", "alpha", "package.json"),
    join("packages", "website", "package.json"),
  ]);

  const rootManifest = await readJson(join(root, "package.json"));
  const alphaManifest = await readJson(
    join(root, "packages", "alpha", "package.json"),
  );
  const websiteManifest = await readJson(
    join(root, "packages", "website", "package.json"),
  );
  assert.equal(rootManifest.version, "1.1.0-rc.1");
  assert.equal(alphaManifest.version, "1.1.0-rc.1");
  assert.equal(alphaManifest.marker, "kept");
  assert.equal(websiteManifest.version, "1.1.0-rc.1");

  assert.deepEqual(await setWorkspaceVersion(root, "1.1.0-rc.1"), []);
});
