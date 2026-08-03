import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeLanguageId, localLineNumber } from "./code-mirror-config";

describe("CodeMirror viewer helpers", () => {
  it("resolves language ids and file extensions", () => {
    assert.equal(codeLanguageId("src/file.ts"), "typescript");
    assert.equal(codeLanguageId("component.svelte"), "svelte");
    assert.equal(codeLanguageId("JSONC"), "jsonc");
    assert.equal(codeLanguageId("Makefile"), undefined);
  });

  it("maps external lines into a windowed document", () => {
    assert.equal(localLineNumber(42, 40, 5), 3);
    assert.equal(localLineNumber(39, 40, 5), undefined);
    assert.equal(localLineNumber(45, 40, 5), undefined);
    assert.equal(localLineNumber(undefined, 40, 5), undefined);
  });
});
