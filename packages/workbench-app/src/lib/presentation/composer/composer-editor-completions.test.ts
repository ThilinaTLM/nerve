import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
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
      referenceCompletions: () => undefined,
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
      referenceCompletions: () => undefined,
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

  it("discovers and routes typed task and pull-request references", async () => {
    const requests: Array<[string, string]> = [];
    const source = createComposerCompletionSource({
      slashCompletions: () => [],
      fileCompletions: () => async () => [
        { label: "@README.md", kind: "file" },
      ],
      referenceCompletions: () => async (kind, query) => {
        requests.push([kind, query]);
        return kind === "task"
          ? [
              {
                label: "task_123",
                displayLabel: "Dev server",
                kind: "task",
              },
            ]
          : [
              {
                label: "https://github.com/acme/app/pull/42",
                displayLabel: "#42 Improve composer",
                kind: "pull_request",
              },
            ];
      },
    });

    const bare = await source(context("@"));
    assert.deepEqual(
      bare?.options.map((option) => option.label),
      ["@task:", "@pr:", "@README.md"],
    );

    const task = await source(context("please @task:dev"));
    assert.deepEqual(requests.at(-1), ["task", "dev"]);
    assert.equal(task?.from, 7);
    assert.equal(task?.options[0]?.apply, "task_123");

    const pr = await source(context("@pr:42"));
    assert.deepEqual(requests.at(-1), ["pull_request", "42"]);
    assert.equal(pr?.options[0]?.apply, "https://github.com/acme/app/pull/42");
  });
});
