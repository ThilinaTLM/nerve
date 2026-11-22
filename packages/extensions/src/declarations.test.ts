import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { builtinExtensions } from "./index.js";

/**
 * Syntax errors of a TypeScript snippet. `sdk.describe` serves `types` and method `signature`s
 * to the agent as declarations, so they must parse; names are not resolved (runtime names such
 * as `FileHandle` need no ambient setup). The SDK build runs the same check for installed ones.
 */
function syntaxErrors(source: string): string[] {
  const { diagnostics = [] } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  );
}

void test("built-in namespace types and method signatures are valid TypeScript", () => {
  const problems: string[] = [];
  for (const extension of builtinExtensions)
    for (const namespace of extension.namespaces) {
      for (const error of syntaxErrors(namespace.types))
        problems.push(`${namespace.id} types: ${error}`);
      for (const [name, method] of Object.entries(namespace.methods))
        for (const error of syntaxErrors(
          `interface Methods {\n${method.signature}\n}`,
        ))
          problems.push(`${namespace.id}.${name} signature: ${error}`);
    }
  assert.deepEqual(problems, []);
});
