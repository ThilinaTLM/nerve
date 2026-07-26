import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validatePublicEvent } from "@nervekit/contracts";
import { NavigationService } from "../src/domains/conversations/operations/navigation-service.js";

const timestamp = "2026-07-26T00:00:00.000Z";

describe("NavigationService", () => {
  it("publishes references for a branch summary larger than the public text limit", async () => {
    let conversation = {
      id: "conv_test",
      projectId: "proj_test",
      title: "Test",
      mode: "coding",
      permissionLevel: "standard",
      approvalPolicy: {},
      activeEntryId: "entry_old",
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never;
    const targetEntry = {
      id: "entry_target",
      conversationId: "conv_test",
      role: "user",
      kind: "message",
      text: "target",
      createdAt: timestamp,
    } as never;
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    let persistedSummary = "";
    let leafId: string | null = "entry_old";
    const targetHarnessEntry = {
      type: "message",
      id: "entry_target",
      parentId: null,
      timestamp,
      message: {
        role: "user",
        content: "target",
        timestamp: Date.parse(timestamp),
      },
    };
    const oldHarnessEntry = {
      type: "message",
      id: "entry_old",
      parentId: "entry_target",
      timestamp,
      message: {
        role: "assistant",
        content: "old branch work",
        timestamp: Date.parse(timestamp),
      },
    };
    const storage = {
      getLeafId: async () => leafId,
      getPathToRoot: async (entryId: string) =>
        entryId === "entry_target"
          ? [targetHarnessEntry]
          : [targetHarnessEntry, oldHarnessEntry],
      setLeafId: async (entryId: string | null) => {
        leafId = entryId;
      },
      appendEntry: async (entry: { id: string; summary: string }) => {
        persistedSummary = entry.summary;
        leafId = entry.id;
      },
    };
    const service = new NavigationService(
      () => conversation,
      () => ({ id: "proj_test", dir: "/tmp/project" }) as never,
      new Map([["conv_test", [targetEntry]]]),
      async (updated) => {
        conversation = updated as never;
      },
      async (input) =>
        ({
          ...input,
          id: "entry_summary",
          parentEntryId: input.parentEntryId ?? undefined,
          kind: input.kind ?? "message",
          createdAt: timestamp,
        }) as never,
      {
        openStorage: async () => storage,
        setLeaf: async (
          _conversation: unknown,
          entryId: string | undefined,
        ) => {
          leafId = entryId ?? null;
        },
      } as never,
      async () => undefined,
      {
        publish: async (type: string, data: Record<string, unknown>) => {
          validatePublicEvent(type, data, "workbench_server");
          events.push({ type, data });
        },
      } as never,
    );

    const updated = await service.navigateConversation("conv_test", {
      activeEntryId: "entry_target",
      summarize: true,
      summaryInstructions: "instruction ".repeat(2_000),
    });

    assert.ok(persistedSummary.length > 16_384);
    assert.equal(updated.activeEntryId, "entry_summary");
    const summarized = events.find(
      (event) => event.type === "conversation.branch_summarized",
    );
    assert.equal(summarized?.data.entryId, "entry_summary");
    assert.equal(summarized?.data.entry, undefined);
    const navigated = events.find(
      (event) => event.type === "conversation.navigated",
    );
    assert.equal(navigated?.data.activeEntryId, "entry_summary");
    assert.equal(navigated?.data.targetEntryId, "entry_target");
    assert.equal(navigated?.data.summaryEntry, undefined);
  });
});
