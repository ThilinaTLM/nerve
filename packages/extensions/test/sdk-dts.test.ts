import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { registeredNamespaces } from "./install.js";
import {
  declarationLine,
  describeDeclarations,
  splitTypes,
  typePool,
} from "@nervekit/tools/quick-script/runtime/sdk-dts";

const pool = typePool(registeredNamespaces);
const named = (id: string) => registeredNamespaces.find((n) => n.id === id)!;

void test("destructive methods are tagged from their declared risk", () => {
  const text = registeredNamespaces
    .filter((namespace) => namespace.methods.length > 0)
    .map((namespace) => describeDeclarations(namespace, pool))
    .join("\n");
  const tagged = [...text.matchAll(/\/\*\* Destructive/g)].length;
  const destructive = registeredNamespaces
    .flatMap((namespace) => namespace.methods)
    .filter((method) => method.risk === "destructive");
  assert.ok(destructive.length >= 4);
  assert.equal(tagged, destructive.length);
  assert.match(
    describeDeclarations(named("jira"), pool),
    /\/\*\* Destructive\. [^\n]*\*\/\n\s+delete\(/,
  );
  assert.match(
    describeDeclarations(named("jira"), pool),
    /\/\*\* Destructive unless GET\./,
  );
});

void test("every namespace's declarations compile on their own", () => {
  for (const namespace of registeredNamespaces) {
    if (namespace.methods.length === 0) continue;
    const text = describeDeclarations(namespace, pool);
    const options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      lib: ["lib.es2022.d.ts"],
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    const file = `/virtual/${namespace.id}.d.ts`;
    host.getSourceFile = (name, ...rest) =>
      name === file
        ? ts.createSourceFile(name, text, ts.ScriptTarget.ES2022)
        : read(name, ...rest);
    host.fileExists = (
      (exists) => (name: string) =>
        name === file || exists(name)
    )(host.fileExists.bind(host));
    const program = ts.createProgram([file], options, host);
    const messages = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    assert.deepEqual(messages, [], namespace.id);
  }
});

void test("a method's declaration brings only the shapes it names", () => {
  const text = describeDeclarations(
    named("confluence"),
    pool,
    "attachments.upload",
  );
  assert.match(text, /type FileHandle = string/);
  assert.match(text, /interface AttachmentInfo/);
  assert.doesNotMatch(text, /interface Space\b/);
  assert.equal(text.match(/upload\(/g)?.length, 1);
});

void test("splitTypes keeps each declaration with its comment", () => {
  const types = splitTypes(
    "/** A. */\ntype A = string;\ntype B = A;\n\ninterface C {\n  x: A;\n}\n",
  );
  assert.deepEqual([...types.keys()], ["A", "B", "C"]);
  assert.equal(types.get("A"), "/** A. */\ntype A = string;");
});

void test("declarationLine is the one-line signature with its full path", () => {
  const method = named("jira").methods.find((m) => m.path === "issues.get")!;
  assert.match(declarationLine(method), /^jira\.issues\.get\(/);
});
