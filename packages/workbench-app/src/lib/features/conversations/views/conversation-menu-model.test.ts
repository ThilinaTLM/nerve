import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { TranscriptMenuTarget } from "$lib/presentation/conversations";
import { transcriptMenuModel } from "./conversation-menu-model";

function menuFor(target: TranscriptMenuTarget, selection?: string) {
  const quotes: string[] = [];
  const copies: string[] = [];
  const items = transcriptMenuModel(target, selection, {
    treeNodesById: new Map(),
    quoteInComposer: (text) => {
      quotes.push(text);
    },
    copyText: (text) => {
      copies.push(text);
    },
  });
  return { items, quotes, copies };
}

function select(items: ContextMenuItem[], label: string) {
  const item = items.find(
    (item) =>
      (item.type === undefined || item.type === "item") && item.label === label,
  );
  assert.ok(item && (item.type === undefined || item.type === "item"));
  assert.ok(!item.disabled);
  assert.ok(item.onSelect);
  item.onSelect();
}

describe("transcript menu quoting", () => {
  for (const kind of ["message", "thinking"] as const) {
    const target = {
      kind,
      item: {
        id: "message_1",
        role: "assistant",
        text: "The full message\nwith more content.",
      },
    } satisfies TranscriptMenuTarget;

    it(`quotes the selected passage from a ${kind}`, () => {
      const { items, quotes } = menuFor(target, "selected passage");
      select(items, "Quote selection");
      assert.deepEqual(quotes, ["selected passage"]);
    });

    it(`preserves multiline selection and whitespace from a ${kind}`, () => {
      const selection = "  first line\nsecond line\n ";
      const { items, quotes } = menuFor(target, selection);
      select(items, "Quote selection");
      assert.deepEqual(quotes, [selection]);
    });

    for (const selection of [undefined, "", " \n\t"]) {
      it(`quotes the full ${kind} with ${JSON.stringify(selection)} selection`, () => {
        const { items, quotes } = menuFor(target, selection);
        select(items, "Quote");
        assert.deepEqual(quotes, [target.item.text]);
      });
    }

    it(`keeps full-content and selection copying distinct for a ${kind}`, () => {
      const { items, copies } = menuFor(target, "selected passage");
      select(items, "Copy content");
      select(items, "Copy selection");
      assert.deepEqual(copies, [target.item.text, "selected passage"]);
    });
  }

  it("does not add Quote to a non-quotable target with a selection", () => {
    const { items } = menuFor(
      { kind: "tool_result_error", toolName: "bash", error: "Command failed" },
      "Command",
    );
    assert.equal(
      items.some(
        (item) =>
          "label" in item &&
          (item.label === "Quote" || item.label === "Quote selection"),
      ),
      false,
    );
  });
});

import type { ConversationTreeNode } from "$lib/api";
import { editHistoryMessage } from "./history-navigation";

function branchFixture(navigation: ConversationTreeNode["navigation"]) {
  const node: ConversationTreeNode = {
    entry: {
      id: "entry_user_transcript",
      conversationId: "conv_branch",
      role: "user",
      kind: "message",
      text: "Edit this prompt",
      parentEntryId: "entry_status_transcript_parent",
      createdAt: "2026-10-09T00:00:00.000Z",
    },
    childEntryIds: [],
    navigation,
  };
  const navigations: Array<string | null> = [];
  const edits: Array<string | null> = [];
  const items = transcriptMenuModel(
    {
      kind: "message",
      item: { id: node.entry.id, role: "user", text: node.entry.text },
    },
    undefined,
    {
      treeNodesById: new Map([[node.entry.id, node]]),
      copyText: () => undefined,
      quoteInComposer: () => undefined,
      onNavigateToEntry: (id) => navigations.push(id),
      onEditEntry: (_entry, target) => edits.push(target.activeEntryId),
    },
  );
  return { node, items, navigations, edits };
}

it("uses explicit model continuation/edit capabilities rather than transcript ids or parents", () => {
  const f = branchFixture({
    continueTarget: { activeEntryId: "entry_owned_model" },
    editTarget: { activeEntryId: "entry_actual_model_parent" },
  });
  select(f.items, "Continue from here");
  select(f.items, "Edit message");
  assert.deepEqual(f.navigations, ["entry_owned_model"]);
  assert.deepEqual(f.edits, ["entry_actual_model_parent"]);
});

it("distinguishes unsupported user-row editing from an explicit null-root edit", () => {
  const unsupported = branchFixture({ continueTarget: null, editTarget: null });
  assert.equal(
    unsupported.items.some(
      (item) =>
        "label" in item &&
        ["Edit message", "Continue from here"].includes(item.label),
    ),
    false,
  );
  const root = branchFixture({
    continueTarget: { activeEntryId: null },
    editTarget: { activeEntryId: null },
  });
  select(root.items, "Edit message");
  select(root.items, "Continue from here");
  assert.deepEqual(root.edits, [null]);
  assert.deepEqual(root.navigations, [null]);
});

it("fills the composer only after successful model-parent navigation, including root", async () => {
  const f = branchFixture({
    continueTarget: null,
    editTarget: { activeEntryId: null },
  });
  const calls: Array<string | null> = [];
  const filled: string[] = [];
  assert.equal(
    await editHistoryMessage(
      f.node.entry,
      f.node.navigation.editTarget!,
      async (id) => {
        calls.push(id);
        return false;
      },
      (text) => filled.push(text),
    ),
    false,
  );
  assert.equal(filled.length, 0);
  assert.equal(
    await editHistoryMessage(
      f.node.entry,
      f.node.navigation.editTarget!,
      async (id) => {
        calls.push(id);
        return true;
      },
      (text) => filled.push(text),
    ),
    true,
  );
  assert.deepEqual(calls, [null, null]);
  assert.deepEqual(filled, [f.node.entry.text]);
});
