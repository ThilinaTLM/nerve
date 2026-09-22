import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeFolding, ensureSyntaxTree, foldable } from "@codemirror/language";
import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  contextSelection,
  copySelectedText,
  isSearchQueryValid,
  searchMatchStatus,
  selectedSearchText,
} from "./code-viewer-helpers";
import type { CodeLanguageId } from "./code-mirror-config";
import {
  codeDocumentLineSeparator,
  codeLanguageId,
  loadCodeLanguage,
  localLineNumber,
  readOnlyCodeExtensions,
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
  "angular",
  "liquid",
  "wast",
];

describe("CodeMirror viewer helpers", () => {
  it("configures file content as editable only when requested", () => {
    const readonly = EditorState.create({
      extensions: readOnlyCodeExtensions({ ariaLabel: "Readonly" }),
    });
    const editable = EditorState.create({
      extensions: readOnlyCodeExtensions({
        ariaLabel: "Editable",
        editable: true,
      }),
    });

    assert.equal(readonly.facet(EditorState.readOnly), true);
    assert.equal(editable.facet(EditorState.readOnly), false);
  });

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
        ["src/app.component.html", "angular"],
        ["templates/product.liquid", "liquid"],
        ["module.wat", "wast"],
        ["module.wast", "wast"],
        [".env", "shellscript"],
        ["config/.env.local", "shellscript"],
        ["Makefile", undefined],
        ["Dockerfile", undefined],
        ["schema.graphql", undefined],
      ];

    for (const [value, expected] of cases) {
      assert.equal(codeLanguageId(value), expected, value);
    }
  });

  it("preserves the source document line separator", () => {
    assert.equal(
      codeDocumentLineSeparator("KEY=value\r\nNEXT=value\r\n"),
      "\r\n",
    );
    assert.equal(codeDocumentLineSeparator("KEY=value\nNEXT=value\n"), "\n");
    assert.equal(codeDocumentLineSeparator("KEY=value\rNEXT=value\r"), "\r");
    assert.equal(codeDocumentLineSeparator("KEY=value"), undefined);

    const dotenv = "KEY=value\r\nNEXT=other\r\n";
    const separator = codeDocumentLineSeparator(dotenv);
    assert.ok(separator);
    const state = EditorState.create({
      doc: dotenv,
      extensions: EditorState.lineSeparator.of(separator),
    });
    assert.equal(state.sliceDoc(), dotenv);
    const edited = state.update({
      changes: { from: 3, insert: "_EDITED" },
    }).state;
    assert.equal(edited.sliceDoc(), "KEY_EDITED=value\r\nNEXT=other\r\n");
  });

  it("loads and activates every newly supported language parser", async () => {
    for (const id of newLanguageIds) {
      const doc =
        id === "angular"
          ? "<div>{{ value }}</div>"
          : id === "liquid"
            ? "{% assign value = 1 %}"
            : id === "wast"
              ? "(module)"
              : "value = 1";
      const state = EditorState.create({
        doc,
        extensions: [await loadCodeLanguage(id)],
      });

      const tree = await ensureSyntaxTree(state, doc.length, 10_000);
      assert.equal(tree?.length, doc.length, id);
    }
  });

  it("maps external lines into a windowed document", () => {
    assert.equal(localLineNumber(42, 40, 5), 3);
    assert.equal(localLineNumber(39, 40, 5), undefined);
    assert.equal(localLineNumber(45, 40, 5), undefined);
    assert.equal(localLineNumber(undefined, 40, 5), undefined);
  });

  it("exposes parser-backed fold ranges", async () => {
    const doc = "function example() {\n  return 1;\n}";
    const state = EditorState.create({
      doc,
      extensions: [await loadCodeLanguage("javascript"), codeFolding()],
    });
    await ensureSyntaxTree(state, doc.length, 10_000);
    const first = state.doc.line(1);
    assert.ok(foldable(state, first.from, first.to));
  });

  it("copies the selected text and ignores an empty selection", () => {
    const copied: string[] = [];
    const selected = EditorState.create({
      doc: "alpha beta",
      selection: { anchor: 0, head: 5 },
    });
    assert.equal(
      copySelectedText(selected, (text) => copied.push(text)),
      true,
    );
    assert.deepEqual(copied, ["alpha"]);

    const empty = EditorState.create({ doc: "alpha beta" });
    assert.equal(
      copySelectedText(empty, (text) => copied.push(text)),
      false,
    );
    assert.deepEqual(copied, ["alpha"]);
  });

  it("seeds search from single-line and multiline selections", () => {
    const selected = EditorState.create({
      doc: "alpha beta",
      selection: { anchor: 0, head: 5 },
    });
    assert.equal(selectedSearchText(selected), "alpha");
    assert.equal(selectedSearchText(selected, 8), undefined);

    const multiline = EditorState.create({
      doc: "alpha\nbeta",
      selection: { anchor: 0, head: 10 },
    });
    assert.equal(selectedSearchText(multiline), "alpha\nbeta");
  });

  it("treats an empty search as valid and rejects invalid regex", () => {
    assert.equal(isSearchQueryValid(new SearchQuery({ search: "" })), true);
    assert.equal(
      isSearchQueryValid(new SearchQuery({ search: "[", regexp: true })),
      false,
    );
  });

  it("counts search matches and identifies the selected match", () => {
    const state = EditorState.create({
      doc: "one two one",
      selection: { anchor: 8, head: 11 },
    });
    const status = searchMatchStatus(state, new SearchQuery({ search: "one" }));
    assert.deepEqual(status, { count: 2, current: 2, capped: false });

    const capped = searchMatchStatus(
      state,
      new SearchQuery({ search: "o" }),
      1,
    );
    assert.deepEqual(capped, { count: 1, current: undefined, capped: true });

    const multiline = EditorState.create({ doc: "alpha\nbeta\nalpha" });
    assert.deepEqual(
      searchMatchStatus(multiline, new SearchQuery({ search: "alpha\nbeta" })),
      { count: 1, current: undefined, capped: false },
    );
  });

  it("preserves a right-click selection only when clicked inside it", () => {
    const state = EditorState.create({
      doc: "alpha beta",
      selection: { anchor: 0, head: 5 },
    });
    assert.equal(contextSelection(state, 3), undefined);
    assert.deepEqual(contextSelection(state, 8), { anchor: 8 });
  });
});
