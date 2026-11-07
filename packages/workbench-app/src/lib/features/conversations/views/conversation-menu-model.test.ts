import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { TranscriptMenuTarget } from "$lib/presentation/conversations";
import type { ConversationEntry } from "$lib/presentation/view-models/conversation";
import { transcriptMenuModel } from "./conversation-menu-model";

const entry = {
  id: "e1",
  conversationId: "c1",
  role: "user",
  kind: "message",
  text: "Hello",
  createdAt: "2026-11-07T00:00:00.000Z",
} as ConversationEntry;
const target = {
  kind: "message",
  item: { id: "e1", text: "Hello" },
} as TranscriptMenuTarget;

function menu(options: { rewindLocked?: boolean; readOnly?: boolean } = {}) {
  const handlers = options.readOnly
    ? {}
    : { onNavigateToEntry: () => undefined, onEditEntry: () => undefined };
  return transcriptMenuModel(target, undefined, {
    treeEntriesById: new Map([["e1", entry]]),
    copyText: () => undefined,
    quoteInComposer: () => undefined,
    onOpenHistory: () => undefined,
    rewindLocked: options.rewindLocked,
    ...handlers,
  });
}

function item(items: ContextMenuItem[], label: string) {
  return items.find(
    (candidate) =>
      (candidate.type === undefined || candidate.type === "item") &&
      candidate.label === label,
  ) as { disabled?: boolean } | undefined;
}

test("offers rewind and edit when the conversation is idle", () => {
  const items = menu();
  assert.equal(item(items, "Rewind to here")?.disabled, undefined);
  assert.equal(item(items, "Edit message")?.disabled, undefined);
  assert.ok(item(items, "History"));
});

test("disables rewind and edit while work is running", () => {
  const items = menu({ rewindLocked: true });
  assert.equal(item(items, "Rewind to here")?.disabled, true);
  assert.equal(item(items, "Edit message")?.disabled, true);
});

test("omits rewind and edit for read-only history but keeps History", () => {
  const items = menu({ readOnly: true });
  assert.equal(item(items, "Rewind to here"), undefined);
  assert.equal(item(items, "Edit message"), undefined);
  assert.ok(item(items, "History"));
});
