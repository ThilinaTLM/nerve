import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import type { ConversationEntry } from "$lib/api";
import type { TranscriptMenuTarget } from "@nervekit/workbench-ui/components/conversation";
import { transcriptMenuModel } from "./conversation-menu-model";

function labels(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) =>
    item.type === "separator" ? ["|"] : "label" in item ? [item.label] : [],
  );
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    treeEntriesById: new Map<string, ConversationEntry>(),
    copyText: () => undefined,
    quoteInComposer: () => undefined,
    ...overrides,
  };
}

const assistantTarget: TranscriptMenuTarget = {
  kind: "message",
  item: { id: "entry_assistant", role: "assistant", text: "Answer" },
};

describe("transcript menus", () => {
  it("keeps copy actions first and reflects selection availability", () => {
    const withoutSelection = transcriptMenuModel(
      assistantTarget,
      undefined,
      context(),
    );
    assert.deepEqual(labels(withoutSelection).slice(0, 3), [
      "Copy selection",
      "Copy content",
      "Quote",
    ]);
    assert.equal(
      withoutSelection[0]?.type === "item" || !withoutSelection[0]?.type
        ? withoutSelection[0].disabled
        : false,
      true,
    );

    const copied: Array<[string, string | undefined]> = [];
    const withSelection = transcriptMenuModel(
      assistantTarget,
      "exact selection",
      context({
        copyText: (text: string, label?: string) => copied.push([text, label]),
      }),
    );
    const copySelection = withSelection[0];
    if (
      !copySelection ||
      copySelection.type === "separator" ||
      copySelection.type === "label" ||
      copySelection.type === "submenu"
    ) {
      assert.fail("expected copy action");
    }
    copySelection.onSelect?.();
    assert.deepEqual(copied, [["exact selection", "selection"]]);
  });

  it("uses concise message actions without redundant branch wording", () => {
    const entry = {
      id: "entry_user",
      role: "user",
      text: "Question",
    } as ConversationEntry;
    const items = transcriptMenuModel(
      { kind: "message", item: { ...entry, role: "user" } },
      undefined,
      context({
        treeEntriesById: new Map([[entry.id, entry]]),
        onEditEntry: () => undefined,
        onNavigateToEntry: () => undefined,
        onOpenHistory: () => undefined,
      }),
    );
    const menuLabels = labels(items);
    assert.deepEqual(menuLabels, [
      "Copy selection",
      "Copy content",
      "Quote",
      "|",
      "Edit message",
      "Continue from here",
      "|",
      "Copy ID",
      "Branch history",
    ]);
    assert.equal(
      menuLabels.some((label) => label.includes("Fork")),
      false,
    );
    assert.equal(menuLabels.includes("Edit & resend"), false);
  });

  it("gives non-message rows meaningful copy and metadata actions only", () => {
    const targets: TranscriptMenuTarget[] = [
      {
        kind: "tool_result_error",
        toolName: "bash",
        error: "command failed",
      },
      {
        kind: "run_status",
        notice: { state: "failed", runId: "run_1", errorMessage: "offline" },
      },
      {
        kind: "compaction",
        notice: { id: "compact_1", state: "completed", summary: "Summary" },
      },
      {
        kind: "task_event",
        notice: { taskId: "task_1", taskName: "Build", status: "failed" },
      },
    ];
    for (const target of targets) {
      const menuLabels = labels(
        transcriptMenuModel(target, undefined, context()),
      );
      assert.deepEqual(menuLabels.slice(0, 2), [
        "Copy selection",
        "Copy content",
      ]);
      assert.equal(menuLabels.includes("Quote"), false);
      assert.equal(menuLabels.includes("Edit message"), false);
      assert.equal(menuLabels.includes("Continue from here"), false);
    }
  });

  it("guards queued prompt actions and emits clean separators", () => {
    const items = transcriptMenuModel(
      {
        kind: "queued_prompt",
        prompt: {
          id: "promptq_1",
          agentId: "agent_1",
          conversationId: "conv_1",
          projectId: "proj_1",
          behavior: "follow-up",
          text: "Next prompt",
          status: "queued",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        busy: true,
        canEdit: true,
        canDiscard: true,
        onEdit: () => undefined,
        onDiscard: () => undefined,
      },
      undefined,
      context(),
    );
    assert.deepEqual(labels(items), [
      "Copy selection",
      "Copy content",
      "|",
      "Edit prompt",
      "Discard",
      "|",
      "Copy ID",
    ]);
    assert.equal(items[2]?.type, "separator");
    assert.equal(items.at(-1)?.type === "separator", false);
    const edit = items[3];
    const discard = items[4];
    assert.equal(
      edit?.type === "item" || !edit?.type ? edit.disabled : false,
      true,
    );
    assert.equal(
      discard?.type === "item" || !discard?.type ? discard.destructive : false,
      true,
    );
  });
});
