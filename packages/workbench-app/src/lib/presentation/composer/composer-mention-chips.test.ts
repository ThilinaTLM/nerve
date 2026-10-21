import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { deleteCharBackward } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import {
  composerMentionChips,
  recognizeMentions,
  insertMentionsTransaction,
  mentionChipsOf,
} from "./composer-mention-chips";

const file = {
  insert: "@src/a.ts",
  label: "a.ts",
  kind: "file" as const,
  title: "src/a.ts",
};

function stateOf(doc: string, anchor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(anchor),
    extensions: composerMentionChips(),
  });
}

describe("composer mention chips", () => {
  it("inserts text with one trailing space and registers the chip", () => {
    const state = stateOf("look at ");
    const next = state.update(insertMentionsTransaction(state, [file])).state;
    assert.equal(next.doc.toString(), "look at @src/a.ts ");
    assert.deepEqual(
      mentionChipsOf(next).map(({ from, to, label }) => [from, to, label]),
      [[8, 17, "a.ts"]],
    );
    assert.equal(next.selection.main.head, 18);
  });

  it("adds a leading space when glued to text and avoids double spaces", () => {
    const state = stateOf("ab cd", 2);
    const next = state.update(
      insertMentionsTransaction(state, [
        file,
        { ...file, insert: "@b", label: "b" },
      ]),
    ).state;
    assert.equal(next.doc.toString(), "ab @src/a.ts @b cd");
    assert.equal(mentionChipsOf(next).length, 2);
  });

  it("replaces an explicit range (the typed mention token)", () => {
    const state = stateOf("see @sr", 7);
    const next = state.update(
      insertMentionsTransaction(state, [file], { from: 4, to: 7 }),
    ).state;
    assert.equal(next.doc.toString(), "see @src/a.ts ");
    assert.equal(mentionChipsOf(next)[0]?.from, 4);
  });

  it("maps chips through edits and drops partially edited ones", () => {
    const state = stateOf("x ");
    let next = state.update(insertMentionsTransaction(state, [file])).state;
    next = next.update({
      changes: { from: 0, insert: "hey " },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(next)[0]?.from, 6);
    next = next.update({
      changes: { from: 8, insert: "Z" },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(next).length, 0);
  });

  it("drops the chip when non-whitespace is glued to its edge, keeps it for whitespace", () => {
    const state = stateOf("");
    const withChip = state.update(
      insertMentionsTransaction(state, [file]),
    ).state;
    const end = withChip.doc.length;
    const glued = withChip.update({
      changes: { from: 9, insert: "go" },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(glued).length, 0);
    const gluedBefore = withChip.update({
      changes: { from: 0, insert: "x" },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(gluedBefore).length, 0);
    const spaced = withChip.update({
      changes: { from: end, insert: "go" },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(spaced).length, 1);
    const newline = withChip.update({
      changes: { from: 9, insert: "\n" },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(newline).length, 1);
  });

  it("undo removes the chip with its text and redo restores it", () => {
    const base = EditorState.create({
      doc: "hi ",
      selection: EditorSelection.cursor(3),
      extensions: [composerMentionChips(), history()],
    });
    let current = base.update(insertMentionsTransaction(base, [file])).state;
    const run = (command: typeof undo) =>
      command({
        state: current,
        dispatch: (tr) => {
          current = tr.state;
        },
      });
    assert.equal(mentionChipsOf(current).length, 1);
    assert.equal(run(undo), true);
    assert.equal(current.doc.toString(), "hi ");
    assert.equal(mentionChipsOf(current).length, 0);
    assert.equal(run(redo), true);
    assert.equal(current.doc.toString(), "hi @src/a.ts ");
    assert.deepEqual(
      mentionChipsOf(current).map(({ from, to, label }) => [from, to, label]),
      [[3, 12, "a.ts"]],
    );
  });

  it("undoing a chip-dropping edit restores the chip", () => {
    const base = EditorState.create({
      doc: "",
      extensions: [composerMentionChips(), history()],
    });
    let current = base.update(insertMentionsTransaction(base, [file])).state;
    current = current.update({
      changes: { from: 9, insert: "go" },
      userEvent: "input.type",
      annotations: isolateHistory.of("full"),
    }).state;
    assert.equal(mentionChipsOf(current).length, 0);
    undo({ state: current, dispatch: (tr) => (current = tr.state) });
    assert.equal(current.doc.toString(), "@src/a.ts ");
    assert.equal(mentionChipsOf(current).length, 1);
  });

  it("recognizes mentions in pasted text and programmatic replacement, not typing", () => {
    const state = stateOf("");
    const pasted = state.update({
      changes: { from: 0, insert: "see @src/a.ts and @pr:12 ok" },
      userEvent: "input.paste",
    }).state;
    assert.deepEqual(
      mentionChipsOf(pasted).map(({ label, kind }) => [label, kind]),
      [
        ["a.ts", "file"],
        ["#12", "pull_request"],
      ],
    );
    const restored = state.update({
      changes: { from: 0, insert: "@skill:qa go" },
    }).state;
    assert.equal(mentionChipsOf(restored).length, 1);
    const typed = state.update({
      changes: { from: 0, insert: "@src/a.t" },
      userEvent: "input.type",
    }).state;
    assert.equal(mentionChipsOf(typed).length, 0);
  });

  it("recognizes mentions in the initial document", () => {
    const state = EditorState.create({
      doc: "see @/a/b/image-1.png and @skill:x",
      extensions: [composerMentionChips()],
    });
    assert.deepEqual(
      mentionChipsOf(state).map(({ label, kind }) => [label, kind]),
      [
        ["image-1.png", "image"],
        ["x", "skill"],
      ],
    );
  });

  it("recognizes a pasted token glued to existing text only as a whole token", () => {
    const state = stateOf("abc");
    const pasted = state.update({
      changes: { from: 3, insert: "@src/a.ts" },
      userEvent: "input.paste",
    }).state;
    assert.equal(mentionChipsOf(pasted).length, 0);
  });

  it("Backspace removes the whole chip (atomic range)", () => {
    const state = stateOf("");
    let current = state.update(insertMentionsTransaction(state, [file])).state;
    // Drop the trailing space so the caret sits right after the chip.
    current = current.update({ changes: { from: 9, to: 10 } }).state;
    assert.equal(mentionChipsOf(current).length, 1);
    // deleteCharBackward only accepts real EditorView instances.
    const view = Object.create(EditorView.prototype, {
      state: { get: () => current },
      dispatch: {
        value: (spec: Parameters<EditorState["update"]>[0]) => {
          current = current.update(spec).state;
        },
      },
    }) as EditorView;
    assert.equal(deleteCharBackward(view), true);
    assert.equal(current.doc.toString(), "");
    assert.equal(mentionChipsOf(current).length, 0);
  });
});

describe("recognizeMentions", () => {
  const rec = (text: string) =>
    recognizeMentions(text).map(({ kind, label, title, from, to }) => ({
      kind,
      label,
      title,
      text: text.slice(from, to),
    }));

  it("recognizes typed mention forms", () => {
    const cases: Array<[string, string, string, string]> = [
      ["@skill:browser-qa", "skill", "browser-qa", "skill:browser-qa"],
      ["@tool:github_search", "tool", "github_search", "tool:github_search"],
      ["@agent:reviewer", "agent_profile", "reviewer", "agent:reviewer"],
      ["@agent:sub_01J9", "agent_profile", "sub_01J9", "agent:sub_01J9"],
      ["@launch:dev", "launch_definition", "dev", "launch:dev"],
      ["@pr:412", "pull_request", "#412", "pr:412"],
      ["@issue:377", "issue", "#377", "issue:377"],
      [
        "@https://github.com/acme/app/pull/42",
        "pull_request",
        "#42",
        "https://github.com/acme/app/pull/42",
      ],
      [
        "@https://github.com/acme/app/issues/7",
        "issue",
        "#7",
        "https://github.com/acme/app/issues/7",
      ],
      ["@src/lib/a.ts", "file", "a.ts", "src/lib/a.ts"],
      ["@./README.md", "file", "README.md", "./README.md"],
      ["@/abs/path/x.json", "file", "x.json", "/abs/path/x.json"],
      ["@~/notes/todo.txt", "file", "todo.txt", "~/notes/todo.txt"],
      ["@package.json", "file", "package.json", "package.json"],
      ["@src/Makefile", "file", "Makefile", "src/Makefile"],
      ["@src/lib/", "directory", "lib", "src/lib/"],
      ["@shot.png", "image", "shot.png", "shot.png"],
      ["@a/b/c.JPG", "image", "c.JPG", "a/b/c.JPG"],
    ];
    for (const [text, kind, label, title] of cases) {
      assert.deepEqual(rec(text), [{ kind, label, title, text }], text);
    }
  });

  it("finds several tokens and excludes trailing punctuation", () => {
    assert.deepEqual(
      rec("@src/a.ts, then @pr:3. Also (@skill:x) and @tool:y!"),
      [
        { kind: "file", label: "a.ts", title: "src/a.ts", text: "@src/a.ts" },
        { kind: "pull_request", label: "#3", title: "pr:3", text: "@pr:3" },
        { kind: "tool", label: "y", title: "tool:y", text: "@tool:y" },
      ],
    );
  });

  it("recognizes tokens after newlines and at text start", () => {
    assert.equal(rec("@a/b.ts\n@c/d.ts").length, 2);
  });

  it("rejects non-mentions", () => {
    const negatives = [
      "user@example.com",
      "mail me at a@b.co please",
      "@word",
      "@",
      "@@src/a.ts",
      "x@src/a.ts",
      "@pr:abc",
      "@pr:",
      "@pr:12abc",
      "@skill:",
      "@unknown:thing",
      "@https://example.com/pull/4",
      "@https://github.com/acme/app/pull/x",
      "@https://github.com/acme/app/tree/main",
      "@v1.2",
      "@//double/slash.ts",
      "@src/a.ts:12",
      "@../",
      "@/",
      "@..",
      "@src/a b.ts is split",
      "plain text with no mention",
      "`@src/a.ts`",
    ];
    for (const text of negatives) {
      const found = rec(text);
      // "@src/a b.ts is split" legitimately yields the first token only.
      if (text.startsWith("@src/a b.ts")) {
        assert.deepEqual(
          found.map((m) => m.text),
          ["@src/a"],
        );
        continue;
      }
      assert.deepEqual(found, [], text);
    }
  });
});
