import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  readFolder,
  readInstalledExtensions,
} from "../../../src/core-host/extension-catalog/read-installed.js";
import { fixtureManifest, writeExtension } from "./fixtures.js";

const NERVE = "0.41.1";
let root = "";
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "installed-discovery-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
/** A fresh extensions root. */
const fresh = async () => {
  const dir = join(root, `case-${counter++}`);
  await mkdir(dir, { recursive: true });
  return dir;
};
const messages = (read: { diagnostics: { message: string }[] }) =>
  read.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

void test("a valid folder yields its manifest without running any code", async () => {
  const dir = await fresh();
  // A backend that would throw if it ever ran.
  await writeExtension(
    dir,
    { id: "csv-viewer" },
    undefined,
    `throw new Error("must not run")`,
  );
  const [read] = await readInstalledExtensions(dir, NERVE);
  assert.equal(read.manifest?.id, "csv-viewer");
  assert.deepEqual(read.diagnostics, []);
  assert.equal(read.incompatible, undefined);
  assert.deepEqual(read.icon, { type: "lucide", name: "blocks" });
});

void test("the folder name must equal the id and follow the skill naming rule", async () => {
  const dir = await fresh();
  await writeExtension(dir, { id: "right", folder: "wrong" });
  await writeExtension(dir, { id: "Bad_Name", folder: "Bad_Name" });
  await writeExtension(dir, { id: "double--hyphen", folder: "double--hyphen" });
  const reads = new Map(
    (await readInstalledExtensions(dir, NERVE)).map((read) => [
      read.folderName,
      read,
    ]),
  );
  assert.match(
    messages(reads.get("wrong")!),
    /must equal the extension id 'right'/,
  );
  assert.match(messages(reads.get("Bad_Name")!), /not a valid extension id/);
  assert.match(messages(reads.get("double--hyphen")!), /consecutive hyphens/);
  for (const read of reads.values()) assert.equal(read.manifest, undefined);
});

void test("unknown and invalid manifest fields are rejected with their path", async () => {
  const dir = await fresh();
  const bad = await writeExtension(dir, { id: "strict" }, (manifest) => {
    manifest.surprise = true;
    (
      manifest.namespaces as { methods: Record<string, { risk: string }> }[]
    )[0].methods.echo.risk = "catastrophic";
  });
  const text = messages(await readFolder("strict", bad, NERVE));
  assert.match(text, /Unrecognized key.*surprise/);
  assert.match(text, /namespaces\.0\.methods\.echo\.risk/);
  // Definition fields installed extensions cannot use say why.
  const unsupported = await writeExtension(
    dir,
    { id: "unsupported" },
    (manifest) => {
      manifest.prelude = "globalThis.x = 1;";
      (manifest.settings as Record<string, unknown>).migrations = { 2: true };
    },
  );
  const reason = messages(await readFolder("unsupported", unsupported, NERVE));
  assert.match(reason, /prelude: installed extensions cannot add helper code/);
  assert.match(
    reason,
    /settings\.migrations: installed extensions cannot declare/,
  );
});

void test("missing and malformed manifests are diagnostics, not crashes", async () => {
  const dir = await fresh();
  await mkdir(join(dir, "no-dist"), { recursive: true });
  await mkdir(join(dir, "bad-json", "dist"), { recursive: true });
  await writeFile(join(dir, "bad-json", "dist", "manifest.json"), "{ nope");
  const reads = new Map(
    (await readInstalledExtensions(dir, NERVE)).map((read) => [
      read.folderName,
      read,
    ]),
  );
  assert.match(messages(reads.get("no-dist")!), /no dist\/manifest\.json/);
  assert.match(messages(reads.get("bad-json")!), /not valid JSON/);
});

void test("discovery honours ignore files and reads only dist/", async () => {
  const dir = await fresh();
  await writeExtension(dir, { id: "kept" });
  await writeExtension(dir, { id: "ignored-by-git" });
  await writeExtension(dir, { id: "ignored-by-fd" });
  await writeExtension(dir, { id: "node_modules", folder: "node_modules" });
  await writeExtension(dir, { id: "dot", folder: ".hidden" });
  await writeFile(join(dir, ".gitignore"), "ignored-by-git/\n");
  await writeFile(join(dir, ".fdignore"), "ignored-by-fd\n");
  // A manifest outside dist/ does not count.
  await mkdir(join(dir, "src-only", "src"), { recursive: true });
  await writeFile(
    join(dir, "src-only", "manifest.json"),
    JSON.stringify(fixtureManifest({ id: "src-only" })),
  );
  const reads = await readInstalledExtensions(dir, NERVE);
  assert.deepEqual(
    reads.map((read) => [read.folderName, Boolean(read.manifest)]),
    [
      ["kept", true],
      ["src-only", false],
    ],
  );
});

void test("SDK compatibility: oldest <= sdkVersion <= running version, otherwise a message that points to the skill", async () => {
  const dir = await fresh();
  for (const [id, sdkVersion] of [
    ["current", "0.41.1"],
    ["oldest", "0.41.0"],
    ["too-old", "0.38.0"],
    ["too-new", "0.42.0"],
  ] as const)
    await writeExtension(dir, { id, sdkVersion });
  const reads = new Map(
    (await readInstalledExtensions(dir, NERVE)).map((read) => [
      read.folderName,
      read,
    ]),
  );
  assert.equal(reads.get("current")!.incompatible, undefined);
  assert.equal(reads.get("oldest")!.incompatible, undefined);
  assert.match(
    reads.get("too-old")!.incompatible!,
    /Built with SDK 0\.38\.0; this Nerve needs 0\.41\.0 or later\. Ask the agent to upgrade it with the configure-nerve skill\./,
  );
  assert.match(
    reads.get("too-new")!.incompatible!,
    /newer than this Nerve \(0\.41\.1\).*configure-nerve skill/,
  );
});

void test("icons and doc topics are read from dist/ and checked like the built-ins'", async () => {
  const dir = await fresh();
  const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;
  const svg = async (id: string, content: string, icon = "icon.svg") => {
    const folder = await writeExtension(dir, { id }, (manifest) => {
      manifest.icon = icon;
    });
    await writeFile(join(folder, "dist", "icon.svg"), content);
    return readFolder(id, folder, NERVE);
  };
  const good = await svg("good-icon", square);
  assert.equal(good.icon?.type, "svg");
  assert.match(
    messages(
      await svg("script-icon", square.replace("<path", "<script/><path")),
    ),
    /must not contain <script>/,
  );
  assert.match(
    messages(await svg("outside-icon", square, "../icon.svg")),
    /outside dist\//,
  );
  assert.match(
    messages(await svg("unknown-icon", square, "no-such-icon")),
    /unknown icon/,
  );
  const docs = await writeExtension(dir, { id: "docs-ext" }, (manifest) => {
    (manifest.namespaces as Record<string, unknown>[])[0].docs = [
      { id: "probe/guide", whenToRead: "Always.", file: "docs/guide.md" },
      { id: "probe/missing", whenToRead: "Never.", file: "docs/missing.md" },
    ];
  });
  await mkdir(join(docs, "dist", "docs"));
  await writeFile(join(docs, "dist", "docs", "guide.md"), "# Guide");
  const read = await readFolder("docs-ext", docs, NERVE);
  assert.equal(read.manifest, undefined);
  assert.match(messages(read), /doc topic 'probe\/missing' cannot be read/);
  assert.doesNotMatch(messages(read), /probe\/guide/);
});
