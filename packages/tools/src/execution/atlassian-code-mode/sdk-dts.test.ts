import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { confluenceMethods } from "./confluence-methods.js";
import { diagramMethods } from "./diagram-methods.js";
import { filesMethods } from "./files-methods.js";
import { imageMethods } from "./image-methods.js";
import { jiraMethods } from "./jira-methods.js";
import { generateSdkDts } from "./sdk-dts.js";
import { STORAGE_PRELUDE } from "./storage-helpers.js";

/** The guide lives in the skills package; walk up from src/ or dist/ to find it. */
function guideDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "skills/src/guides/atlassian-code-mode");
    if (existsSync(join(candidate, "SKILL.md"))) return candidate;
    const parent = dirname(dir);
    assert.notEqual(parent, dir, "atlassian-code-mode guide not found");
    dir = parent;
  }
}

const guide = guideDir();
const references = join(guide, "references");
const generated = generateSdkDts([
  ...jiraMethods,
  ...confluenceMethods,
  ...diagramMethods,
  ...filesMethods,
  ...imageMethods,
]);

void test("references/*.d.ts match the method tables (UPDATE_SDK_DTS=1 regenerates)", () => {
  assert.deepEqual(Object.keys(generated).sort(), [
    "confluence.d.ts",
    "files.d.ts",
    "jira.d.ts",
  ]);
  for (const [name, content] of Object.entries(generated)) {
    if (process.env.UPDATE_SDK_DTS === "1") {
      writeFileSync(join(references, name), content);
    }
    assert.equal(readFileSync(join(references, name), "utf8"), content, name);
  }
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
