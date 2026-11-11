import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { atlassianMethods } from "./atlassian/defaults.js";
import { confluenceMethods } from "./confluence/methods.js";
import { diagramMethods } from "./files/diagram-methods.js";
import { filesMethods } from "./files/files-methods.js";
import { imageMethods } from "./files/image-methods.js";
import { jiraMethods } from "./jira/methods.js";
import { webMethods } from "./web/web-methods.js";
import { generateSdkDts } from "./sdk-dts.js";
import { STORAGE_PRELUDE } from "./files/storage-helpers.js";

/** The guide lives in the skills package; walk up from src/ or dist/ to find it. */
function guideDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "skills/src/guides/quick-script");
    if (existsSync(join(candidate, "SKILL.md"))) return candidate;
    const parent = dirname(dir);
    assert.notEqual(parent, dir, "quick-script guide not found");
    dir = parent;
  }
}

const guide = guideDir();
const references = join(guide, "references");
const generated = generateSdkDts([
  ...atlassianMethods,
  ...jiraMethods,
  ...confluenceMethods,
  ...diagramMethods,
  ...filesMethods,
  ...imageMethods,
  ...webMethods,
]);

void test("references/*.d.ts match the method tables (UPDATE_SDK_DTS=1 regenerates)", () => {
  assert.deepEqual(Object.keys(generated).sort(), [
    "atlassian.d.ts",
    "confluence.d.ts",
    "files.d.ts",
    "jira.d.ts",
    "web.d.ts",
  ]);
  for (const [name, content] of Object.entries(generated)) {
    if (process.env.UPDATE_SDK_DTS === "1") {
      writeFileSync(join(references, name), content);
    }
    assert.equal(readFileSync(join(references, name), "utf8"), content, name);
  }
});

void test("destructive methods are tagged from their declared risk", () => {
  const all = [
    ...atlassianMethods,
    ...jiraMethods,
    ...confluenceMethods,
    ...diagramMethods,
    ...filesMethods,
    ...imageMethods,
    ...webMethods,
  ];
  const text = Object.values(generated).join("\n");
  const tagged = [...text.matchAll(/\/\*\* Destructive/g)].length;
  const destructive = all.filter((m) => m.risk === "destructive");
  assert.ok(destructive.length >= 4);
  assert.equal(tagged, destructive.length);
  assert.match(
    generated["jira.d.ts"],
    /\/\*\* Destructive\. [^\n]*\*\/\n\s+delete\(/,
  );
  assert.match(generated["jira.d.ts"], /\/\*\* Destructive unless GET\./);
});

void test("generated .d.ts files compile together", () => {
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    lib: ["lib.es2022.d.ts"],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  const virtual = new Map(
    Object.entries(generated).map(([name, content]) => [
      join(references, name),
      content,
    ]),
  );
  host.getSourceFile = (name, ...rest) => {
    const content = virtual.get(resolve(name));
    return content === undefined
      ? read(name, ...rest)
      : ts.createSourceFile(name, content, ts.ScriptTarget.ES2022);
  };
  const program = ts.createProgram([...virtual.keys()], options, host);
  const messages = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  assert.deepEqual(messages, []);
});

void test("storage.md documents every storage helper and SKILL.md links existing files", () => {
  const returned = STORAGE_PRELUDE.slice(
    STORAGE_PRELUDE.lastIndexOf("return {"),
  );
  const helpers = [...returned.matchAll(/^ {4}(\w+)(?::|,)/gm)].map(
    (m) => m[1],
  );
  assert.ok(helpers.length > 0);
  const storage = readFileSync(join(guide, "references/storage.md"), "utf8");
  for (const name of helpers) {
    assert.ok(
      storage.includes(`\`storage.${name}(`),
      `storage.md misses ${name}`,
    );
  }
  const skill = readFileSync(join(guide, "SKILL.md"), "utf8");
  for (const [, link] of skill.matchAll(/\]\((references\/[^)]+)\)/g)) {
    assert.ok(existsSync(join(guide, link)), `SKILL.md links missing ${link}`);
  }
});

void test("SDK calls and storage helpers named in the Markdown guide exist", () => {
  const sdk = new Set(
    [
      ...atlassianMethods,
      ...jiraMethods,
      ...confluenceMethods,
      ...diagramMethods,
      ...filesMethods,
      ...imageMethods,
    ].map((method) => `${method.product}.${method.path}`),
  );
  const returned = STORAGE_PRELUDE.slice(
    STORAGE_PRELUDE.lastIndexOf("return {"),
  );
  const storage = new Set(
    [...returned.matchAll(/^ {4}(\w+)(?::|,)/gm)].map((m) => m[1]),
  );
  const files = [
    "SKILL.md",
    ...readdirSync(references)
      .filter((name) => name.endsWith(".md"))
      .map((name) => join("references", name)),
  ];
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(join(guide, file), "utf8");
    for (const [, name] of text.matchAll(
      /\b((?:jira|confluence|files|diagram|image)(?:\.\w+)+)\(/g,
    )) {
      assert.ok(sdk.has(name), `${file} uses unknown ${name}(`);
      checked += 1;
    }
    for (const [, name] of text.matchAll(/\bstorage\.(\w+)\(/g)) {
      assert.ok(storage.has(name), `${file} uses unknown storage.${name}(`);
      checked += 1;
    }
  }
  assert.ok(checked > 10);
});
