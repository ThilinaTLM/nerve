import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { CompletionItem } from "@nervekit/contracts/completions";
import {
  buildMentionGroups,
  buildSlashGroups,
  loadingState,
  parseMentionScope,
  toPopupRow,
} from "./composer-completion-model";
import {
  ComposerCompletionController,
  completionTokenAt,
  emptyMentionText,
  isCompletionConflict,
  type ComposerCompletionOptions,
  type ComposerReferenceSource,
  type PopupModel,
} from "./composer-editor-completions";
import { composerMentionChips, mentionChipsOf } from "./composer-mention-chips";

/** Simulates typing `doc` (typed text is never turned into chips). */
function stateAt(doc: string, head = doc.length): EditorState {
  const empty = EditorState.create({ extensions: [composerMentionChips()] });
  return empty.update({
    changes: { from: 0, insert: doc },
    selection: { anchor: head },
    userEvent: "input.type",
  }).state;
}

const file = (path: string): CompletionItem => ({
  kind: "file",
  label: `@${path}`,
  info: path,
});
const pr = (n: number): CompletionItem => ({
  kind: "pull_request",
  label: `@pr:${n}`,
  displayLabel: `#${n} Title`,
  detail: "feat · tlm",
});

describe("completion tokens", () => {
  it("ends a mention at whitespace", () => {
    assert.equal(
      completionTokenAt(stateAt("see @src/a.ts"), true)?.raw,
      "@src/a.ts",
    );
    assert.equal(completionTokenAt(stateAt("see @src/a.ts "), true), undefined);
    assert.equal(completionTokenAt(stateAt("mail me@host"), true), undefined);
  });

  it("treats a restored complete mention as a chip, not a live token", () => {
    const restored = EditorState.create({
      doc: "see @src/a.ts",
      selection: { anchor: 13 },
      extensions: [composerMentionChips()],
    });
    assert.equal(mentionChipsOf(restored).length, 1);
    assert.equal(completionTokenAt(restored, true), undefined);
  });

  it("parses scopes and aliases", () => {
    assert.deepEqual(parseMentionScope("pr:42"), { scope: "pr", query: "42" });
    assert.deepEqual(parseMentionScope("profile:x"), {
      scope: "agent",
      query: "x",
    });
    assert.deepEqual(parseMentionScope("foo:bar"), { query: "foo:bar" });
    const token = completionTokenAt(stateAt("@skill:br"), true)!;
    assert.equal(token.scope, "skill");
    assert.equal(token.query, "br");
    assert.equal(token.scopeLength, 6);
  });

  it("only offers slash commands at the very start of the prompt", () => {
    assert.equal(completionTokenAt(stateAt("/pla"), true)?.kind, "slash");
    assert.equal(completionTokenAt(stateAt("/pla"), false), undefined);
    assert.equal(completionTokenAt(stateAt("hi /pla"), true), undefined);
    assert.equal(completionTokenAt(stateAt("hi\n/pla"), true), undefined);
  });
});

describe("popup groups", () => {
  it("caps unscoped groups at three, adds server more counts, sorts unavailable last", () => {
    const items: CompletionItem[] = [
      { ...pr(1), available: false },
      pr(2),
      pr(3),
      file("a.ts"),
    ];
    const groups = buildMentionGroups({
      items,
      recent: false,
      totals: [{ group: "pull_requests", more: 2 }],
    });
    assert.deepEqual(
      groups.map((g) => g.label),
      ["Pull requests", "Files"],
    );
    assert.equal(groups[0]!.rows.length, 3);
    assert.equal(groups[0]!.rows[2]!.state, "unavailable");
    assert.equal(groups[0]!.more, 2);
    assert.equal(groups[0]!.scope, "pr");
    assert.equal(groups[1]!.more, undefined);
  });

  it("scoped search shows up to 12 rows; bare @ is one Recent group", () => {
    const many = Array.from({ length: 15 }, (_, i) => pr(i + 1));
    const scoped = buildMentionGroups({
      items: many,
      scope: "pr",
      recent: false,
    });
    assert.equal(scoped[0]!.rows.length, 12);
    const recent = buildMentionGroups({
      items: [file("a"), pr(1)],
      recent: true,
    });
    assert.deepEqual(
      recent.map((g) => g.label),
      ["Recent"],
    );
  });

  it("badges from raw status and shows Updating only for declared groups", () => {
    const merged = toPopupRow({ ...pr(1), status: "merged" });
    assert.deepEqual(merged.badge, { text: "Merged", variant: "info" });
    assert.equal(
      toPopupRow({ kind: "launch", label: "l", status: "failed" }).badge
        ?.variant,
      "destructive",
    );
    const off = toPopupRow({
      kind: "skill",
      label: "s",
      enabled: false,
      status: "open",
    });
    assert.equal(off.badge?.text, "Off", "Off/Unavailable outrank status");
    const declared = loadingState([
      {
        source: "github",
        status: "fresh",
        refreshing: true,
        groups: ["pull_requests"],
      },
      { source: "other", status: "loading" },
    ]);
    assert.deepEqual([...declared], ["pr"]);
  });

  it("derives row presentation and off/toggle state", () => {
    const row = toPopupRow({
      kind: "file",
      label: "@pkg/src/a.ts",
      info: "pkg/src/a.ts",
    });
    assert.equal(row.name, "a.ts");
    assert.equal(row.dir, "pkg/src/");
    assert.equal(row.mono, true);
    assert.equal(row.title, "pkg/src/a.ts");
    assert.equal(
      toPopupRow({ kind: "skill", label: "@skill:q", info: "project skill" })
        .title,
      "project skill",
    );
    const skill = toPopupRow({
      kind: "skill",
      label: "@skill:qa",
      documentId: "d",
      version: "1",
      enabled: false,
      available: true,
    });
    assert.equal(skill.state, "off");
    assert.equal(skill.badge?.text, "Off");
    assert.equal(skill.toggleable, true);
  });

  it("builds slash groups: labels without slash, current mode, abort only while running", () => {
    const items: CompletionItem[] = [
      "plan",
      "code",
      "compact",
      "abort",
      "new",
    ].map((name) => ({ kind: "slash", label: `/${name}`, detail: name }));
    const idle = buildSlashGroups(items, "/", {
      mode: "coding",
      running: false,
    });
    assert.deepEqual(
      idle.map((g) => g.label),
      ["Mode", "Conversation"],
    );
    assert.equal(idle[0]!.rows.find((r) => r.name === "code")?.current, true);
    assert.equal(idle[0]!.rows.find((r) => r.name === "plan")?.current, false);
    const running = buildSlashGroups(items, "/ab", {
      mode: "planning",
      running: true,
    });
    assert.deepEqual(
      running.map((g) => g.label),
      ["Run"],
    );
  });
});

function harness(raw: Partial<ComposerCompletionOptions> = {}) {
  const overrides = { ...raw };
  if (raw.referenceSource) {
    const stable = raw.referenceSource();
    overrides.referenceSource = () => stable;
  }
  let state = stateAt("");
  const models: Array<PopupModel | null> = [];
  const dispatched: TransactionSpec[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      dispatched.push(spec);
      const tr = state.update(spec);
      state = tr.state;
      controller.onUpdate({
        docChanged: tr.docChanged,
        selectionSet: true,
        state,
        changes: tr.changes,
        transactions: [tr],
      });
    },
  };
  const options: ComposerCompletionOptions = {
    slashCompletions: () => [],
    fileCompletions: () => undefined,
    referenceCompletions: () => undefined,
    searchDelayMs: 0,
    onModel: (model) => models.push(model),
    ...overrides,
  };
  const controller = new ComposerCompletionController(view as never, options);
  const type = (text: string) =>
    view.dispatch({
      changes: { from: state.doc.length, insert: text },
      selection: { anchor: state.doc.length + text.length },
      userEvent: "input.type",
    });
  const last = () => models.at(-1) ?? null;
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    controller,
    view,
    type,
    last,
    settle,
    dispatched,
    get state() {
      return state;
    },
  };
}

function source(
  items: CompletionItem[],
  extra: Partial<ComposerReferenceSource> = {},
): ComposerReferenceSource {
  return {
    async search() {
      return { items, sources: [] };
    },
    async select(item) {
      return item;
    },
    subscribe: () => () => {},
    ...extra,
  };
}

describe("composer completion controller", () => {
  it("opens for a mention, groups it, and inserts a chip on Enter", async () => {
    const h = harness({
      referenceSource: () => source([file("src/App.svelte"), pr(7)]),
    });
    h.type("look at @app");
    await h.settle();
    assert.equal(h.last()?.mode, "mention");
    assert.equal(h.last()?.placement, "above");
    assert.equal(h.last()?.groups.length, 2);
    assert.equal(h.controller.accept(), true);
    await h.settle();
    assert.equal(h.state.doc.toString(), "look at @src/App.svelte ");
    const chips = mentionChipsOf(h.state);
    assert.equal(chips.length, 1);
    assert.equal(chips[0]!.label, "App.svelte");
    assert.equal(h.last(), null);
  });

  it("shows No matches, closes on space, and Esc sticks for the same token", async () => {
    const h = harness({ referenceSource: () => source([]) });
    h.type("@zzz");
    await h.settle();
    assert.equal(h.last()?.empty, "No matches for “zzz”");
    assert.equal(h.controller.accept(), false, "Enter falls through to send");
    h.controller.dismiss();
    assert.equal(h.last(), null);
    h.type("z");
    await h.settle();
    assert.equal(h.last(), null, "same token stays dismissed");
    h.type(" @n");
    await h.settle();
    assert.equal(h.last()?.mode, "mention", "a new token reopens");
    h.type(" ");
    assert.equal(h.last(), null);
  });

  it("moves selection bottom-up when above and top-down when below", async () => {
    const items = [file("a.ts"), file("b.ts"), file("c.ts")];
    const h = harness({ referenceSource: () => source(items) });
    h.type("@x");
    await h.settle();
    const ids = h.last()!.groups[0]!.rows.map((r) => r.id);
    assert.equal(h.last()!.selectedId, ids[0]);
    h.controller.move("up");
    assert.equal(h.last()!.selectedId, ids[1], "up = next best when above");
    h.controller.move("down");
    assert.equal(h.last()!.selectedId, ids[0]);
  });

  it("widens a scoped search with Backspace on an empty query", async () => {
    const h = harness({ referenceSource: () => source([pr(1)]) });
    h.type("@pr:");
    await h.settle();
    assert.equal(h.last()?.scope?.label, "Pull requests");
    assert.equal(h.controller.backspace(), true);
    assert.equal(h.state.doc.toString(), "@");
    await h.settle();
    assert.equal(h.last()?.scope, undefined);
    assert.equal(h.last()?.showScopeHint, true);
  });

  it("words empty states per category, quoting only a real query", async () => {
    assert.equal(
      emptyMentionText({ scope: "pr", query: "" }),
      "No pull requests to show",
    );
    assert.equal(
      emptyMentionText({ scope: "skill", query: "" }),
      "No skills to show",
    );
    assert.equal(
      emptyMentionText({ scope: "file", query: "" }),
      "No files to show",
    );
    assert.equal(
      emptyMentionText({ scope: "pr", query: "x" }),
      "No matches for “x”",
    );
    assert.equal(emptyMentionText({ query: "" }), "Nothing to suggest yet");
    const h = harness({ referenceSource: () => source([]) });
    h.type("@pr:");
    await h.settle();
    assert.equal(h.last()?.empty, "No pull requests to show");
    h.type("zz");
    await h.settle();
    assert.equal(h.last()?.empty, "No matches for “zz”");
  });

  it("narrows to a category from +N more", async () => {
    const h = harness({ referenceSource: () => source([pr(1)]) });
    h.type("@auth");
    await h.settle();
    h.controller.setScope("pr");
    assert.equal(h.state.doc.toString(), "@pr:auth");
  });

  it("toggles skills in place, keeping the popup open", async () => {
    const item: CompletionItem = {
      kind: "skill",
      label: "@skill:qa",
      documentId: "d1",
      version: "1",
      enabled: false,
      available: true,
    };
    const actions: string[] = [];
    const h = harness({
      referenceSource: () =>
        source([item], {
          async select(selected, action) {
            actions.push(action);
            return { ...selected, enabled: true, canDisable: true };
          },
        }),
    });
    h.type("@qa");
    await h.settle();
    assert.equal(h.last()?.primary, "Enable & insert");
    assert.equal(h.last()?.toggleLabel, "Turn on");
    assert.equal(h.last()?.footer?.text, "Also turns it on for this project");
    h.controller.toggle();
    await h.settle();
    assert.deepEqual(actions, ["select"]);
    assert.equal(h.state.doc.toString(), "@qa");
    assert.ok(h.last());
  });

  it("explains unavailable rows instead of inserting", async () => {
    const h = harness({
      referenceSource: () =>
        source([
          {
            kind: "tool",
            label: "@tool:pg",
            available: false,
            unavailableReason: "Pick a profile.",
          },
        ]),
    });
    h.type("@pg");
    await h.settle();
    h.controller.accept();
    assert.equal(h.state.doc.toString(), "@pg");
    assert.equal(h.last()?.footer?.text, "Pick a profile.");
  });

  it("re-searches on CONFLICT, keeps the selection, and retries on Enter", async () => {
    const items: CompletionItem[] = [
      { kind: "skill", label: "@skill:a", documentId: "a", version: "1" },
      { kind: "skill", label: "@skill:b", documentId: "b", version: "1" },
    ];
    let searches = 0;
    let fail = true;
    const h = harness({
      referenceSource: () =>
        source(items, {
          async search() {
            searches++;
            return { items, sources: [] };
          },
          async select(item) {
            if (fail) throw Object.assign(new Error("x"), { code: "CONFLICT" });
            return item;
          },
        }),
    });
    h.type("@s");
    await h.settle();
    h.controller.move("up");
    const selected = h.last()!.selectedId;
    h.controller.accept();
    await h.settle();
    assert.equal(searches, 2);
    assert.equal(h.last()?.selectedId, selected);
    assert.match(
      h.last()?.footer?.text ?? "",
      /changed while you were choosing/,
    );
    fail = false;
    h.controller.accept();
    await h.settle();
    assert.equal(h.state.doc.toString(), "@skill:b ");
    assert.equal(isCompletionConflict({ data: { code: "CONFLICT" } }), true);
  });

  it("names unavailable sources with one action", async () => {
    const h = harness({
      referenceSource: () => ({
        ...source([]),
        async search() {
          return {
            items: [],
            sources: [
              {
                source: "github",
                groups: ["pull_requests" as const],
                label: "GitHub",
                status: "unavailable" as const,
                action: "open_pull_requests" as const,
                reason: "GitHub isn’t connected for this project.",
              },
            ],
          };
        },
      }),
      action: () => () => {},
    });
    h.type("@pr:");
    await h.settle();
    assert.equal(
      h.last()?.footer?.text,
      "GitHub isn’t connected for this project.",
    );
    assert.equal(h.last()?.footer?.action?.label, "Open pull requests");
  });

  it("runs a slash command immediately and clears the prompt", async () => {
    const ran: string[] = [];
    const h = harness({
      slashCompletions: () => [
        { kind: "slash", label: "/plan", detail: "Planning" },
        { kind: "slash", label: "/code", detail: "Coding" },
      ],
      slashContext: () => ({ mode: "coding", running: false }),
      slashCommand: () => (name) => ran.push(name),
    });
    h.type("/pl");
    assert.equal(h.last()?.mode, "slash");
    assert.equal(
      h.last()?.footer?.text,
      "Runs now — nothing is sent to the agent",
    );
    h.controller.accept();
    assert.deepEqual(ran, ["plan"]);
    assert.equal(h.state.doc.toString(), "");
  });
});
