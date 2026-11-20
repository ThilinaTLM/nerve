// The built-in `configure-nerve` skill: its guide's links and its plain-Node scripts. The
// declaration pointers and theme-token mentions are checked against the generated reference in
// scripts/build/skill-reference-assets.test.ts.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = join(
  here,
  "..",
  "..",
  "src",
  "builtin-skills",
  "builtin",
  "configure-nerve",
);

void test("extensions guide links only to files that exist", async () => {
  const text = await readFile(join(skill, "guide", "extensions.md"), "utf8");
  const paths = [
    ...text.matchAll(/`((?:reference\/extensions|scripts)\/[\w./-]+?)`/g),
  ].map((match) => match[1]!);
  assert.ok(paths.length >= 6, paths.join(", "));
  for (const path of paths) await stat(join(skill, path.replace(/\/$/, "")));
});

// ── The scripts ───────────────────────────────────────────────────────────

type Lib = {
  compareVersions(a: string, b: string): number;
  upgradeNotes(markdown: string, from: string, to: string): string;
  resolveSdk(
    dir: string,
    env?: Record<string, string>,
  ): { spec: string; dependency: string; version?: string };
  targetFolder(
    input: { id: string; scope?: string; project?: string; dir?: string },
    env?: Record<string, string>,
  ): string;
  parseArgs(
    argv: string[],
    flags: string[],
  ): { positional: string[]; flags: Record<string, string> };
};
const lib = (await import(
  pathToFileURL(join(skill, "scripts", "lib.mjs")).href
)) as Lib;
// From a source checkout the skill targets the repository's version, which the SDK shares.
const repoPackage = JSON.parse(
  await readFile(join(here, "..", "..", "..", "..", "package.json"), "utf8"),
) as { version: string };

void test("the scripts target the SDK of this Nerve's version", async () => {
  // From a source checkout the version is the repository's, which the SDK shares.
  const sdk = lib.resolveSdk(join(skill, "scripts"), {});
  assert.equal(sdk.version, repoPackage.version);
  assert.equal(sdk.spec, `@nervekit/extension-sdk@${repoPackage.version}`);
  // A packaged skill carries the version next to the scripts.
  const root = await mkdtemp(join(tmpdir(), "nerve-skill-version-"));
  try {
    await cp(join(skill, "scripts"), root, { recursive: true });
    await writeFile(join(root, "nerve-version.json"), '{"version":"1.2.3"}\n');
    assert.equal(lib.resolveSdk(root, {}).version, "1.2.3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  // Maintainers point at a tarball before the SDK is published.
  const local = lib.resolveSdk(root, {
    NERVE_EXTENSION_SDK_SPEC: "/tmp/sdk.tgz",
  });
  assert.deepEqual(
    [local.spec, local.dependency, local.version],
    ["/tmp/sdk.tgz", "/tmp/sdk.tgz", undefined],
  );
});

void test("the upgrade script prints the UPGRADING.md sections between two versions", async () => {
  const markdown = `# Upgrading\n\n## 0.43.0\nC\n\n## 0.42.0\nB\n\n## 0.40.0\nA\n\n<!-- end -->\n`;
  assert.equal(lib.upgradeNotes(markdown, "0.40.0", "0.42.0"), "## 0.42.0\nB");
  assert.equal(
    lib.upgradeNotes(markdown, "0.39.0", "0.43.0"),
    "## 0.40.0\nA\n\n## 0.42.0\nB\n\n## 0.43.0\nC",
  );
  assert.equal(lib.compareVersions("0.41.1", "0.9.9"), 1);
});

void test("the create script resolves the user and project folders", () => {
  assert.equal(
    lib.targetFolder({ id: "x", scope: "user" }, { NERVE_HOME: "/h" }),
    "/h/agent/extensions/x",
  );
  assert.equal(
    lib.targetFolder({ id: "x", scope: "project", project: "/p" }),
    "/p/.nerve/extensions/x",
  );
  assert.equal(lib.targetFolder({ id: "x", dir: "/d/x" }), "/d/x");
  assert.throws(
    () => lib.parseArgs(["--nope", "1"], ["kind"]),
    /Unknown option/,
  );
});
