import assert from "node:assert/strict";
import test from "node:test";
import { parsePorcelain } from "../commit-release.ts";
import { assertNextReleaseVersion } from "../prepare-release.ts";
import {
  assertInventory,
  CHECKSUMS_FILE,
  formatChecksums,
  packTarballFilename,
  parseChecksums,
  releasePackages,
} from "../release-artifacts.ts";

test("a release is plain SemVer above the current version", () => {
  assert.equal(assertNextReleaseVersion("0.41.1", "0.41.2"), "0.41.2");
  assert.equal(assertNextReleaseVersion("0.41.1", "0.42.0"), "0.42.0");
  assert.equal(assertNextReleaseVersion("0.41.1", "1.0.0"), "1.0.0");
  for (const version of [
    "0.41.1",
    "0.41.0",
    "0.40.9",
    "0.42.0-rc.1",
    "v0.42.0",
    "0.42",
  ])
    assert.throws(() => assertNextReleaseVersion("0.41.1", version), version);
});

test("release packages are listed in publish order", async () => {
  const packages = await releasePackages("1.2.3");
  assert.equal(packages.length, 10);
  assert.ok(
    packages
      .slice(0, 6)
      .every((entry) => entry.name.startsWith("@nervekit/native-")),
  );
  assert.deepEqual(
    packages.slice(6),
    [
      "@nervekit/desktop",
      "@nervekit/extension-api",
      "@nervekit/ui-kit",
      "@nervekit/extension-sdk",
    ].map((name) => ({ name, tarball: packTarballFilename(name, "1.2.3") })),
  );
  assert.equal(
    packTarballFilename("@nervekit/ui-kit", "1.2.3"),
    "nervekit-ui-kit-1.2.3.tgz",
  );
});

test("checksums round-trip in sha256sum format", () => {
  const sums = new Map([
    ["b.tgz", "b".repeat(64)],
    ["a.tgz", "a".repeat(64)],
  ]);
  const text = formatChecksums(sums);
  assert.equal(text, `${"a".repeat(64)}  a.tgz\n${"b".repeat(64)}  b.tgz\n`);
  assert.deepEqual(parseChecksums(text), sums);
  assert.throws(() => parseChecksums("nothex  a.tgz\n"));
  assert.throws(() => parseChecksums(`${text}${"c".repeat(64)}  a.tgz\n`));
});

test("the inventory must match exactly", () => {
  const expected = ["a.tgz", "b.tgz"];
  assertInventory(["b.tgz", "a.tgz", CHECKSUMS_FILE], expected, {
    withChecksums: true,
  });
  assert.throws(
    () => assertInventory(["a.tgz"], expected, { withChecksums: false }),
    /Missing: b\.tgz/,
  );
  assert.throws(
    () =>
      assertInventory(["a.tgz", "b.tgz", "c.tgz"], expected, {
        withChecksums: false,
      }),
    /Unexpected: c\.tgz/,
  );
});

test("release changes become commit additions and deletions", () => {
  assert.deepEqual(
    parsePorcelain(" M package.json\0?? new.json\0 D gone.ts\0M  staged.ts\0"),
    {
      additions: [
        { path: "package.json" },
        { path: "new.json" },
        { path: "staged.ts" },
      ],
      deletions: [{ path: "gone.ts" }],
    },
  );
  assert.throws(() => parsePorcelain("R  new.ts\0old.ts\0"), /rename/);
});
