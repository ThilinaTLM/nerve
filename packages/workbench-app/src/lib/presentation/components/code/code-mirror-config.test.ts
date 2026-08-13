import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { CodeLanguageId } from "./code-mirror-config";
import {
  codeLanguageId,
  loadCodeLanguage,
  localLineNumber,
  shouldShowCodeMinimap,
} from "./code-mirror-config";

const newLanguageIds: CodeLanguageId[] = [
  "toml",
  "java",
  "cpp",
  "xml",
  "rust",
  "sass",
  "scss",
  "go",
  "php",
  "sql",
  "vue",
  "less",
];

describe("CodeMirror viewer helpers", () => {
  it("resolves language ids and file extensions", () => {
    const cases: Array<[value: string, expected: CodeLanguageId | undefined]> =
      [
        ["src/file.ts", "typescript"],
        ["src/module.mts", "typescript"],
        ["src/module.cts", "typescript"],
        ["component.svelte", "svelte"],
        ["JSONC", "jsonc"],
        ["config/app.toml", "toml"],
        ["src/Main.java", "java"],
        ["native/source.c", "cpp"],
        ["native/source.C++", "cpp"],
        ["native/include/value.hpp", "cpp"],
        [String.raw`C:\project\schema.XSD`, "xml"],
        ["src/lib.rs", "rust"],
        ["styles/theme.sass", "sass"],
        ["styles/theme.scss", "scss"],
        ["cmd/server/main.go", "go"],
        ["public/index.phtml", "php"],
        ["migrations/001.create-table.SQL", "sql"],
        ["src/App.vue", "vue"],
        ["styles/theme.less", "less"],
        ["Makefile", undefined],
      ];

    for (const [value, expected] of cases) {
      assert.equal(codeLanguageId(value), expected, value);
    }
  });

  it("loads and activates every newly supported language parser", async () => {
    for (const id of newLanguageIds) {
      const doc = "value = 1";
      const state = EditorState.create({
        doc,
        extensions: [await loadCodeLanguage(id)],
      });

      const tree = await ensureSyntaxTree(state, doc.length, 10_000);
      assert.equal(tree?.length, doc.length, id);
    }
  });

  it("shows the minimap only for long, unwrapped documents", () => {
    const lines = (count: number) =>
      Array.from({ length: count }, () => "x").join("\n");

    assert.equal(shouldShowCodeMinimap(lines(100), false), false);
    assert.equal(shouldShowCodeMinimap(lines(101), false), true);
    assert.equal(shouldShowCodeMinimap(lines(101), true), false);
    assert.equal(shouldShowCodeMinimap("", false), false);
  });

  it("maps external lines into a windowed document", () => {
    assert.equal(localLineNumber(42, 40, 5), 3);
    assert.equal(localLineNumber(39, 40, 5), undefined);
    assert.equal(localLineNumber(45, 40, 5), undefined);
    assert.equal(localLineNumber(undefined, 40, 5), undefined);
  });
});
