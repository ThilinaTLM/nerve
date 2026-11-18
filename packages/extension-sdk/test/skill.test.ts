// The built-in `configure-nerve` skill (packages/workbench-server/src/builtin-skills/builtin/
// configure-nerve) points at this SDK's declarations and quotes a few of its facts. These tests keep
// those from drifting, build the skill's examples with the SDK, and cover the skill's plain-Node scripts.
import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { themeTokenNames } from "@nervekit/contracts/extensions";
import { buildExtension } from "../src/build.ts";

const here = dirname(fileURLToPath(import.meta.url));
const skill = join(
  here,
  "..",
  "..",
  "workbench-server",
  "src",
  "builtin-skills",
  "builtin",
  "configure-nerve",
);
const reference = (name: string) =>
  readFile(join(skill, "reference", "extensions", `${name}.md`), "utf8");

function assertMentions(text: string, names: readonly string[], where: string) {
  const missing = names.filter((name) => !text.includes(`\`${name}`));
  assert.deepEqual(
    missing,
    [],
    `${where} must mention (in backticks): ${missing.join(", ")}`,
  );
}

void test("themes.md lists every theme token", async () => {
  const themes = await reference("themes");
  assertMentions(themes, themeTokenNames, "references/themes.md");
  assert.ok(themes.includes(`all ${themeTokenNames.length} tokens`));
});

// The prose points at declarations as `Symbol` (`reference/extensions/api/<package>/<file>.d.ts`);
// the build copies those files from this SDK and extension-api, so check each pointer against the sources.
void test("every declaration pointer in the references names an export of that file", async () => {
  const sources: Record<string, string> = {
    "extension-api": join(here, "..", "..", "extension-api", "src"),
    "extension-sdk": join(here, "..", "src"),
  };
  const files = [
    join(skill, "guide", "extensions.md"),
    ...(await readdir(join(skill, "reference", "extensions")))
      .filter((name) => name.endsWith(".md"))
      .map((name) => join(skill, "reference", "extensions", name)),
  ];
  let count = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const [, symbol, pkg, path] of text.matchAll(
      /`(\w+)` \(`reference\/extensions\/api\/(extension-api|extension-sdk)\/([\w/-]+)\.d\.ts`\)/g,
    )) {
      const base = join(sources[pkg!]!, path!);
      const source = await readFile(`${base}.ts`, "utf8").catch(() =>
        readFile(`${base}.d.ts`, "utf8"),
      );
      assert.match(
        source,
        new RegExp(
          `export (?:declare )?(?:const|function|type|interface|class|let) ${symbol}\\b`,
        ),
        `${file}: ${symbol} is not exported by ${pkg}/${path}`,
      );
      count++;
    }
  }
  assert.ok(count >= 20, `only ${count} pointers found`);
});

void test("extensions guide links only to files that exist", async () => {
  const text = await readFile(join(skill, "guide", "extensions.md"), "utf8");
  const paths = [
    ...text.matchAll(
      /`((?:reference\/extensions|scripts|examples\/extensions)\/[\w./-]+?)`/g,
    ),
  ].map((match) => match[1]!);
  assert.ok(paths.length >= 6, paths.join(", "));
  for (const path of paths) await stat(join(skill, path.replace(/\/$/, "")));
});

// ── The examples are complete projects the SDK can build ──────────────────

const examples = ["csv-preview", "paper-theme"];

for (const name of examples)
  void test(`the example ${name} builds`, async () => {
    const folder = join(skill, "examples", "extensions", name);
    const entries = await readdir(folder);
    assert.ok(!entries.includes("node_modules") && !entries.includes("dist"));
    const root = await mkdtemp(join(tmpdir(), "nerve-skill-example-"));
    try {
      const copy = join(root, name);
      await cp(folder, copy, { recursive: true });
      const { manifest, distDir } = await buildExtension({ projectDir: copy });
      assert.equal(manifest.id, name);
      const ui = manifest.ui!;
      if (name === "csv-preview") {
        assert.deepEqual(ui.previews?.[0]?.match.extensions, [".csv", ".tsv"]);
        await stat(join(distDir, ui.previews![0]!.entry));
      } else {
        assert.equal(ui.themes?.[0]?.kind, "light");
        await stat(join(distDir, "themes", `${name}.json`));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
const sdkPackage = JSON.parse(
  await readFile(join(here, "..", "package.json"), "utf8"),
) as { version: string };

void test("the scripts target the SDK of this Nerve's version", async () => {
  // From a source checkout the version is the repository's, which the SDK shares.
  const sdk = lib.resolveSdk(join(skill, "scripts"), {});
  assert.equal(sdk.version, sdkPackage.version);
  assert.equal(sdk.spec, `@nervekit/extension-sdk@${sdkPackage.version}`);
  // A packaged skill carries the version next to the scripts.
  const root = await mkdtemp(join(tmpdir(), "nerve-skill-version-"));
  try {
    await cp(join(skill, "scripts"), root, { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(join(root, "nerve-version.json"), '{"version":"1.2.3"}\n'),
    );
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
  const real = await readFile(join(here, "..", "UPGRADING.md"), "utf8");
  assert.equal(lib.upgradeNotes(real, "0.1.0", "99.0.0"), "");
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
