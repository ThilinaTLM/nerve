// The built-in `extension-creator` skill (packages/workbench-server/src/builtin-skills/builtin/
// extension-creator) mirrors this SDK in prose. These tests keep the parts that mirror code from
// drifting, build the skill's examples with the SDK, and cover the skill's plain-Node scripts.
import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bridgeErrorCodeSchema,
  bridgeEvents,
  bridgeLimits,
  bridgeMethodNames,
  extensionUiLimits,
  installedExtensionManifestSchema,
  themeTokenNames,
} from "@nervekit/contracts/extensions";
import { EXTENSION_ERROR_CODES } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
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
  "extension-creator",
);
const reference = (name: string) =>
  readFile(join(skill, "references", `${name}.md`), "utf8");

function assertMentions(text: string, names: readonly string[], where: string) {
  const missing = names.filter((name) => !text.includes(`\`${name}`));
  assert.deepEqual(
    missing,
    [],
    `${where} must mention (in backticks): ${missing.join(", ")}`,
  );
}

void test("the references mention every bridge method, event, error code and component", async () => {
  const ui = await reference("ui");
  assertMentions(ui, bridgeMethodNames, "references/ui.md");
  assertMentions(
    ui,
    Object.keys(bridgeEvents).map(eventHandler),
    "ui.md events",
  );
  assertMentions(ui, bridgeErrorCodeSchema.options, "references/ui.md");
  const components = await readFile(
    join(here, "..", "src", "ui", "components.d.ts"),
    "utf8",
  );
  const names = [
    ...components.matchAll(/^export (?:const|function) (\w+)/gm),
  ].map((match) => match[1]!);
  assert.ok(names.length > 20);
  assertMentions(ui, names, "references/ui.md components");
  // Numbers the prose quotes.
  for (const text of [
    String(bridgeLimits.maxMenuItems),
    String(extensionUiLimits.maxExtensionsPerPreview),
  ])
    assert.ok(ui.includes(text), `ui.md must state the limit ${text}`);
  assert.ok(
    (await reference("manifest")).includes(
      String(extensionUiLimits.maxPerKind),
    ),
  );
});

// `onFileChange` for `fileChanged`, and so on.
function eventHandler(event: string): string {
  return `host.on${event[0]!.toUpperCase()}${event
    .slice(1)
    .replace(/ed$/, "")
    .replace(/Chang$/, "Change")}`;
}

void test("themes.md lists every theme token", async () => {
  const themes = await reference("themes");
  assertMentions(themes, themeTokenNames, "references/themes.md");
  assert.ok(themes.includes(`all ${themeTokenNames.length} tokens`));
});

void test("backend.md covers every ctx service, risk and error code", async () => {
  const backend = await reference("backend");
  const { ctx } = createFakeContext({
    vision: { explain: () => ({ text: "", model: "" }) },
  });
  assertMentions(
    backend,
    Object.keys(ctx).map((key) => `ctx.${key}`),
    "references/backend.md",
  );
  assertMentions(
    backend,
    ["none", "read", "external_read", "write", "external_write", "destructive"],
    "references/backend.md risks",
  );
  assertMentions(
    backend,
    EXTENSION_ERROR_CODES,
    "references/backend.md errors",
  );
});

void test("manifest.md mentions every field of manifest.json", async () => {
  const manifest = await reference("manifest");
  assertMentions(
    manifest,
    Object.keys(installedExtensionManifestSchema.shape),
    "references/manifest.md",
  );
});

void test("SKILL.md links only to files that exist", async () => {
  const text = await readFile(join(skill, "SKILL.md"), "utf8");
  const paths = [
    ...text.matchAll(/`((?:references|scripts|examples)\/[\w./-]+?)`/g),
  ].map((match) => match[1]!);
  assert.ok(paths.length >= 6, paths.join(", "));
  for (const path of paths) await stat(join(skill, path.replace(/\/$/, "")));
});

// ── The examples are complete projects the SDK can build ──────────────────

const examples = ["csv-preview", "paper-theme"];

for (const name of examples)
  void test(`the example ${name} builds`, async () => {
    const folder = join(skill, "examples", name);
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
