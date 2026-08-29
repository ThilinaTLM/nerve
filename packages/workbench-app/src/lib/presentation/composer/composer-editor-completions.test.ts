import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts";
import {
  composerCompletionBoost,
  createComposerCompletionSource,
  toComposerCompletion,
} from "./composer-editor-completions";

function context(doc: string, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, doc.length, explicit);
}

describe("composer editor completions", () => {
  it("maps scores, sections, kinds, and match ranges", () => {
    assert.equal(composerCompletionBoost(undefined), undefined);
    assert.equal(composerCompletionBoost(160), 1);
    assert.equal(composerCompletionBoost(100_000), 99);
    assert.equal(composerCompletionBoost(-100_000), -99);

    const command = toComposerCompletion({ label: "/compact", kind: "slash" });
    const file = toComposerCompletion({
      label: "@src/App.svelte",
      kind: "file",
      matchRanges: [[1, 4]],
    });

    assert.equal(command.type, "keyword");
    assert.equal(
      typeof command.section === "object" ? command.section.name : undefined,
      "Commands",
    );
    assert.equal(file.type, "file");
    assert.equal(
      typeof file.section === "object" ? file.section.name : undefined,
      "Project references",
    );
    assert.deepEqual(file.matchRanges, [1, 4]);
  });

  it("filters slash completions against the current token", async () => {
    const items: CompletionItem[] = [
      { label: "/compact", kind: "slash" },
      { label: "/clear", kind: "slash" },
      { label: "/mode", kind: "slash" },
    ];
    const source = createComposerCompletionSource({
      slashCompletions: () => items,
      fileCompletions: () => undefined,
    });

    const result = await source(context("run /co"));
    assert.deepEqual(
      result?.options.map((option) => option.label),
      ["/compact"],
    );
    assert.equal(result?.from, 4);
  });

  it("limits and reverses project file results while using live getters", async () => {
    let query = "";
    let completions = Array.from(
      { length: FILE_COMPLETION_RESULT_LIMIT + 3 },
      (_, index): CompletionItem => ({
        label: `@src/file-${index}.ts`,
        kind: "file",
      }),
    );
    const source = createComposerCompletionSource({
      slashCompletions: () => [],
      fileCompletions: () => async (value) => {
        query = value;
        return completions;
      },
    });

    const result = await source(context("@src"));
    assert.equal(query, "src");
    assert.equal(result?.options.length, FILE_COMPLETION_RESULT_LIMIT);
    assert.equal(
      result?.options[0]?.label,
      `@src/file-${FILE_COMPLETION_RESULT_LIMIT - 1}.ts`,
    );

    completions = [{ label: "@other.ts", kind: "file" }];
    const next = await source(context("@other"));
    assert.deepEqual(
      next?.options.map((option) => option.label),
      ["@other.ts"],
    );
  });
});
