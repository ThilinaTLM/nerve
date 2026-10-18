import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CompletionContext,
  autocompletion,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import {
  composerCompletionBoost,
  createComposerCompletionSource,
  toComposerCompletion,
  type ComposerReferenceSource,
  type ComposerCompletionOptions,
  runComposerReferenceAction,
  invalidateComposerCompletionRequests,
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

  it("limits and preserves server file order while using live getters", async () => {
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
    assert.equal(result?.options[0]?.label, "@src/file-0.ts");

    await source(context("@file:src"));
    assert.equal(query, "src");

    completions = [{ label: "@other.ts", kind: "file" }];
    const next = await source(context("@other"));
    assert.deepEqual(
      next?.options.map((option) => option.label),
      ["@other.ts"],
    );
  });

  it("discovers and routes typed launch and pull-request references", async () => {
    const requests: Array<[string, string]> = [];
    const source = createComposerCompletionSource({
      slashCompletions: () => [],
      fileCompletions: () => async () => [
        { label: "@README.md", kind: "file" },
      ],
      referenceCompletions: () => async (kind, query) => {
        requests.push([kind, query]);
        return kind === "launch"
          ? [
              {
                label: "launch_123",
                displayLabel: "Dev server",
                kind: "launch",
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
      ["@README.md", "@launch:", "@pr:"],
    );

    const launch = await source(context("please @launch:dev"));
    assert.deepEqual(requests.at(-1), ["launch", "dev"]);
    assert.equal(launch?.from, 7);
    assert.equal(launch?.options[0]?.apply, "launch_123");

    const pr = await source(context("@pr:42"));
    assert.deepEqual(requests.at(-1), ["pull_request", "42"]);
    assert.equal(pr?.options[0]?.apply, "https://github.com/acme/app/pull/42");
  });

  it("preserves blended native order, routes all prefixes unchanged, and rejects stale scope responses", async () => {
    const queries: string[] = [];
    const items: CompletionItem[] = [
      {
        label: "@skill:session",
        kind: "skill",
        documentId: "skill",
        version: "v1",
        enabled: false,
        available: true,
        canDisable: true,
      },
      { label: "@src/session.ts", kind: "file" },
      { label: "https://example.invalid/pr/1", kind: "pull_request" },
    ];
    const references: ComposerReferenceSource = {
      async search(query) {
        queries.push(query);
        return {
          revision: 1,
          items,
          sources: [{ source: "remote", status: "loading" }],
        };
      },
      async select(item) {
        return item;
      },
      subscribe: () => () => {},
    };
    let current: ComposerReferenceSource | undefined = references;
    let notice = "";
    const source = createComposerCompletionSource({
      slashCompletions: () => [],
      fileCompletions: () => undefined,
      referenceCompletions: () => undefined,
      referenceSource: () => current,
      notice: (message) => {
        notice = message;
      },
    });
    for (const prefix of [
      "",
      "file:",
      "pr:",
      "issue:",
      "skill:",
      "tool:",
      "agent:",
      "profile:",
      "launch:",
    ]) {
      for (const suffix of ["", "session"]) {
        const result = await source(context(`@${prefix}${suffix}`));
        assert.deepEqual(
          result?.options.map((item) => item.label),
          items.map((item) => item.label),
        );
        assert.equal(queries.at(-1), `${prefix}${suffix}`);
        assert.equal(notice, "Refreshing completions");
        assert.match(result?.options[0]?.detail ?? "", /Disabled/);
      }
    }
    await source(context("please @file:auth sess"));
    assert.equal(queries.at(-1), "file:auth sess");
    let finish!: (
      value: Awaited<ReturnType<ComposerReferenceSource["search"]>>,
    ) => void;
    references.search = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = source(context("@session"));
    current = undefined;
    finish({ revision: 1, items, sources: [] });
    assert.equal(await pending, null);
  });

  it("coalesces repeated accepts, waits for enable, inserts once and does not overwrite a changed document", async () => {
    const item: CompletionItem = {
      documentId: "skill",
      version: "v1",
      label: "@skill:session",
      kind: "skill",
      enabled: false,
      available: true,
      canDisable: true,
    };
    let finish!: (value: CompletionItem) => void;
    const actions: string[] = [];
    const references: ComposerReferenceSource = {
      async search() {
        return { revision: 1, items: [item], sources: [] };
      },
      select(_item, action) {
        actions.push(action);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      subscribe: () => () => {},
    };
    const source = createComposerCompletionSource({
      slashCompletions: () => [],
      fileCompletions: () => undefined,
      referenceCompletions: () => undefined,
      referenceSource: () => references,
    });
    const result = await source(context("@sess"));
    const option = result!.options[0]!;
    assert.equal(typeof option.apply, "function");
    let state = EditorState.create({ doc: "@sess" });
    let insertions = 0;
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: TransactionSpec) {
        if (spec.changes) insertions++;
        state = state.update(spec).state;
      },
    } as EditorView;
    if (typeof option.apply !== "function")
      throw new Error("Expected selection action");
    option.apply(view, option, 0, 5);
    option.apply(view, option, 0, 5);
    option.apply(view, option, 0, 5);
    assert.deepEqual(
      actions,
      ["select"],
      "repeated keyboard/pointer acceptance must not start duplicate owner writes",
    );
    assert.equal(state.doc.toString(), "@sess");
    finish({ ...item, enabled: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.doc.toString(), "@skill:session");
    assert.equal(insertions, 1);
    state = EditorState.create({ doc: "@sess" });
    option.apply(view, option, 0, 5);
    state = state.update({
      changes: { from: 0, to: 5, insert: "different draft" },
    }).state;
    finish({ ...item, enabled: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.doc.toString(), "different draft");
    assert.deepEqual(actions, ["select", "select"]);
  });

  for (const changed of ["document", "source"] as const)
    it(`old pending action cannot block or clear a new ${changed} generation`, async () => {
      const item: CompletionItem = {
        kind: "tool",
        label: "@tool:session",
        available: true,
        enabled: false,
      };
      const resolvers: ((item: CompletionItem) => void)[] = [];
      let writes = 0;
      const reference: ComposerReferenceSource = {
        async search() {
          return { revision: 1, items: [item], sources: [] };
        },
        select() {
          writes++;
          return new Promise((resolve) => {
            resolvers.push(resolve);
          });
        },
        subscribe: () => () => {},
      };
      let current = reference;
      let state = EditorState.create({ doc: "@session" });
      const view = {
        get state() {
          return state;
        },
        dispatch() {},
      } as unknown as EditorView;
      const options: ComposerCompletionOptions = {
        slashCompletions: () => [],
        fileCompletions: () => undefined,
        referenceCompletions: () => undefined,
        referenceSource: () => current,
      };
      const applied: string[] = [];
      runComposerReferenceAction(view, options, current, item, "select", () => {
        applied.push("old");
      });
      if (changed === "document")
        state = state.update({
          changes: { from: 0, to: state.doc.length, insert: "@new" },
        }).state;
      else current = { ...reference };
      runComposerReferenceAction(view, options, current, item, "select", () => {
        applied.push("new");
      });
      assert.equal(writes, 2);
      resolvers[0]!({ ...item, enabled: true });
      await new Promise<void>((resolve) => setImmediate(resolve));
      runComposerReferenceAction(view, options, current, item, "select");
      assert.equal(
        writes,
        2,
        "stale finally cannot unlock the newer in-flight action",
      );
      assert.deepEqual(applied, []);
      resolvers[1]!({ ...item, enabled: true });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(applied, ["new"]);
    });

  it("unavailable trust state dominates configured-enabled label and prevents selection", async () => {
    const blocked: CompletionItem = {
      kind: "subagent_profile",
      label: "@agent:blocked",
      enabled: true,
      available: false,
      canDisable: false,
      unavailableReason: "Profile is untrusted",
    };
    let selections = 0;
    const reference: ComposerReferenceSource = {
      async search() {
        return { revision: 1, items: [blocked], sources: [] };
      },
      async select() {
        selections++;
        return blocked;
      },
      subscribe: () => () => {},
    };
    let notice = "";
    const source = createComposerCompletionSource({
      slashCompletions: () => [],
      fileCompletions: () => undefined,
      referenceCompletions: () => undefined,
      referenceSource: () => reference,
      notice: (message) => {
        notice = message;
      },
    });
    const result = await source(context("@profile:"));
    const option = result!.options[0]!;
    assert.match(option.detail ?? "", /Profile is untrusted/);
    assert.doesNotMatch(option.detail ?? "", /Enabled ·|Alt\+Shift\+D/);
    const view = {
      state: EditorState.create({ doc: "@profile:" }),
      dispatch() {
        throw new Error("Blocked reference cannot insert text");
      },
    } as unknown as EditorView;
    assert.equal(typeof option.apply, "function");
    if (typeof option.apply === "function")
      option.apply(view, option, 0, view.state.doc.length);
    assert.equal(selections, 0);
    assert.equal(notice, "Profile is untrusted");
  });

  it("closes successful selection before its own insertion invalidates the request generation", async () => {
    const item: CompletionItem = {
      kind: "tool",
      label: "@tool:session",
      documentId: "tool",
      version: "v1",
      available: true,
      enabled: true,
    };
    const reference: ComposerReferenceSource = {
      async search() {
        return { revision: 1, items: [], sources: [] };
      },
      async select() {
        return item;
      },
      subscribe: () => () => {},
    };
    let notice = "";
    const options: ComposerCompletionOptions = {
      slashCompletions: () => [],
      fileCompletions: () => undefined,
      referenceCompletions: () => undefined,
      referenceSource: () => reference,
      notice: (message) => {
        notice = message;
      },
    };
    let state = EditorState.create({
      doc: "@session",
      extensions: [autocompletion({ override: [() => null] })],
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: TransactionSpec) {
        state = state.update(transaction).state;
      },
    } as unknown as EditorView;
    startCompletion(view);
    assert.equal(completionStatus(state), "pending");
    runComposerReferenceAction(
      view,
      options,
      reference,
      item,
      "select",
      (selected) => {
        assert.equal(
          completionStatus(state),
          null,
          "own selection must close before the doc listener invalidates its generation",
        );
        state = state.update({
          changes: { from: 0, to: state.doc.length, insert: selected.label },
        }).state;
        invalidateComposerCompletionRequests(options);
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.doc.toString(), item.label);
    assert.equal(notice, "");
    assert.equal(completionStatus(state), null);
  });

  it("ignores stale search failures after source change or a newer request completes", async () => {
    let rejectFirst!: (error: Error) => void;
    let calls = 0;
    const reference: ComposerReferenceSource = {
      search() {
        if (++calls === 1)
          return new Promise((_resolve, reject) => {
            rejectFirst = reject;
          });
        return Promise.resolve({
          revision: 1,
          items: [],
          sources: [{ source: "remote", status: "stale", refreshing: false }],
        });
      },
      async select(item) {
        return item;
      },
      subscribe: () => () => {},
    };
    let current: ComposerReferenceSource = reference;
    let notice = "";
    const options: ComposerCompletionOptions = {
      slashCompletions: () => [],
      fileCompletions: () => undefined,
      referenceCompletions: () => undefined,
      referenceSource: () => current,
      notice: (message) => {
        notice = message;
      },
    };
    const source = createComposerCompletionSource(options);
    const old = source(context("@old"));
    await source(context("@new"));
    assert.equal(notice, "Some completion results are stale");
    rejectFirst(new Error("Old request failed"));
    assert.equal(await old, null);
    assert.equal(notice, "Some completion results are stale");
    calls = 0;
    const oldProject = source(context("@old-project"));
    current = { ...reference };
    notice = "Current project notice";
    rejectFirst(new Error("Old project failed"));
    assert.equal(await oldProject, null);
    assert.equal(notice, "Current project notice");
  });

  for (const action of ["select", "disable"] as const) {
    it(`ignores stale ${action} failures after source/doc changes and later requests`, async () => {
      let rejectAction!: (error: Error) => void;
      const reference: ComposerReferenceSource = {
        async search() {
          return {
            revision: 1,
            items: [],
            sources: [{ source: "remote", status: "stale", refreshing: false }],
          };
        },
        select() {
          return new Promise((_resolve, reject) => {
            rejectAction = reject;
          });
        },
        subscribe: () => () => {},
      };
      let current: ComposerReferenceSource = reference;
      let notice: string;
      let state = EditorState.create({ doc: "@session" });
      let sideEffects = 0;
      const view = {
        get state() {
          return state;
        },
        dispatch() {
          sideEffects++;
        },
      } as unknown as EditorView;
      const item: CompletionItem = {
        kind: "tool",
        label: "@tool:session",
        documentId: "tool",
        version: "v1",
        enabled: true,
        available: true,
        canDisable: true,
      };
      const options: ComposerCompletionOptions = {
        slashCompletions: () => [],
        fileCompletions: () => undefined,
        referenceCompletions: () => undefined,
        referenceSource: () => current,
        notice: (message) => {
          notice = message;
        },
      };
      const source = createComposerCompletionSource(options);
      runComposerReferenceAction(view, options, reference, item, action);
      current = { ...reference };
      notice = "New project notice";
      rejectAction(new Error("Old source action failed"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(notice, "New project notice");
      current = reference;
      runComposerReferenceAction(view, options, reference, item, action);
      await source(context("@later"));
      assert.equal(notice, "Some completion results are stale");
      rejectAction(new Error("Older action failed after later request"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(notice, "Some completion results are stale");
      runComposerReferenceAction(view, options, reference, item, action);
      state = state.update({
        changes: { from: 0, to: state.doc.length, insert: "changed draft" },
      }).state;
      notice = "New draft notice";
      rejectAction(new Error("Old draft action failed"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(notice, "New draft notice");
      assert.equal(
        sideEffects,
        0,
        "stale operations cannot close/rewrite the current editor",
      );
    });
  }
});
