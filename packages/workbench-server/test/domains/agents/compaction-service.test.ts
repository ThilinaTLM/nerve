import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validatePublicEvent } from "@nervekit/contracts/events";
import { CompactionService } from "../../../src/domains/conversations/operations/compaction-service.js";
import { buildPlanImplementationSummary } from "../../../src/domains/conversations/operations/summary.js";

const timestamp = "2026-07-19T00:00:00.000Z";

function structuredSummary(): string {
  return `## Goal
Finish the task.

## Requirements and Constraints
- Preserve behavior.

## Work Completed
- [x] Inspected files.

## Work Remaining
- [ ] Implement changes.

## Key Decisions
- **Policy**: Use iteration boundaries.

## Current Working State
- Implementation pending.

## Continuation Plan
1. Implement and test.

## Critical References
- packages/harness`;
}

describe("CompactionService", () => {
  it("builds a concise structured fallback for plan implementation", () => {
    const planPath = "/tmp/approved-plan.md";
    const summary = buildPlanImplementationSummary(planPath);

    assert.match(summary, /## Goal/);
    assert.match(summary, /## Work Remaining/);
    assert.match(summary, /implementation has not started/i);
    assert.match(summary, new RegExp(planPath.replaceAll("/", "\\/")));
    assert.doesNotMatch(summary, /conversation excerpt/i);
  });

  it("forwards the summary budget and records model provenance and policy", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    let summarizerBudget = 0;
    let summaryProfile: unknown;
    const branch = [
      {
        type: "message",
        id: "entry_old",
        parentId: null,
        timestamp,
        message: {
          role: "user",
          content: "x".repeat(20_000),
          timestamp: Date.parse(timestamp),
        },
      },
      {
        type: "message",
        id: "entry_recent",
        parentId: "entry_old",
        timestamp,
        message: {
          role: "user",
          content: "continue",
          timestamp: Date.parse(timestamp),
        },
      },
    ];
    const appendedHarness: Array<{ id: string; parentId?: string | null }> = [];
    let openedStorage = false;
    let activeLeafId = "entry_recent";
    const activeStorage = {
      getLeafId: async () => activeLeafId,
      getPathToRoot: async () => branch,
      appendEntry: async (entry: { id: string; parentId?: string | null }) => {
        appendedHarness.push(entry);
        activeLeafId = entry.id;
      },
    };
    const service = new CompactionService(
      () => ({ id: "conv_test", projectId: "proj_test" }) as never,
      () => ({ id: "proj_test", dir: "/tmp/project" }) as never,
      async (input) =>
        ({
          ...input,
          id: "entry_compaction",
          parentEntryId: input.parentEntryId ?? null,
          kind: input.kind ?? "message",
          createdAt: input.createdAt ?? timestamp,
        }) as never,
      {
        openStorage: async () => {
          openedStorage = true;
          return activeStorage;
        },
      } as never,
      async () => undefined,
      {
        publish: async (type: string, data: unknown) => {
          validatePublicEvent(type, data, "workbench_server");
          events.push({ type, data });
        },
      } as never,
      async (input) => {
        summarizerBudget = input.summaryReserveTokens;
        summaryProfile = input.summaryProfile;
        return { text: structuredSummary(), generatedBy: "model" };
      },
    );

    const result = await service.compactConversation(
      "conv_test",
      {},
      {
        reason: "threshold",
        agentId: "agent_test",
        runId: "run_test",
        contextWindow: 100_000,
        contextTokens: 80_000,
        thresholdTokens: 80_000,
        keepRecentTokens: 1,
        summaryReserveTokens: 8_000,
        profile: "balanced",
        thresholdPercent: 80,
        keepRecentPercent: 15,
        safetyHeadroomTokens: 10_000,
        activeConversation: { getStorage: () => activeStorage } as never,
        summaryProfile: {
          kind: "plan-implementation",
          planPath: "/tmp/approved-plan.md",
        },
      },
    );

    assert.equal(summarizerBudget, 8_000);
    const details = result.entry.details as {
      generatedBy?: string;
      policy?: Record<string, unknown>;
      freedTokens?: number;
      summaryProfile?: string;
    };
    assert.equal(details.generatedBy, "model");
    assert.equal(details.summaryProfile, "plan-implementation");
    assert.deepEqual(summaryProfile, {
      kind: "plan-implementation",
      planPath: "/tmp/approved-plan.md",
    });
    assert.equal(details.policy?.profile, "balanced");
    assert.equal(details.policy?.summaryReserveTokens, 8_000);
    assert.ok((details.freedTokens ?? 0) > 0);
    assert.equal(openedStorage, false);
    assert.equal(appendedHarness.length, 1);
    assert.equal(appendedHarness[0]?.parentId, "entry_recent");
    assert.equal(activeLeafId, "entry_compaction");
    const continuation = {
      id: "entry_continuation",
      parentId: await activeStorage.getLeafId(),
    };
    await activeStorage.appendEntry(continuation);
    assert.equal(continuation.parentId, "entry_compaction");
    assert.ok(
      events.some((event) => event.type === "conversation.compaction.started"),
    );
    const compacted = events.find(
      (event) => event.type === "conversation.compacted",
    );
    assert.ok(compacted);
    assert.equal(
      (compacted.data as { entryId?: string }).entryId,
      "entry_compaction",
    );
    assert.equal((compacted.data as { entry?: unknown }).entry, undefined);
  });

  it("publishes a reference event for summaries larger than the public text limit", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const branch = [
      {
        type: "message",
        id: "entry_old",
        parentId: null,
        timestamp,
        message: {
          role: "user",
          content: "source ".repeat(20_000),
          timestamp: Date.parse(timestamp),
        },
      },
      {
        type: "message",
        id: "entry_recent",
        parentId: "entry_old",
        timestamp,
        message: {
          role: "user",
          content: "continue",
          timestamp: Date.parse(timestamp),
        },
      },
    ];
    let activeLeafId = "entry_recent";
    const storage = {
      getLeafId: async () => activeLeafId,
      getPathToRoot: async () => branch,
      appendEntry: async (entry: { id: string }) => {
        activeLeafId = entry.id;
      },
    };
    const largeSummary = `${structuredSummary()}\n${"detail ".repeat(3_000)}`;
    const service = new CompactionService(
      () => ({ id: "conv_test", projectId: "proj_test" }) as never,
      () => ({ id: "proj_test", dir: "/tmp/project" }) as never,
      async (input) =>
        ({
          ...input,
          id: "entry_compaction",
          parentEntryId: input.parentEntryId ?? null,
          kind: input.kind ?? "message",
          createdAt: input.createdAt ?? timestamp,
        }) as never,
      { openStorage: async () => storage } as never,
      async () => undefined,
      {
        publish: async (type: string, data: unknown) => {
          validatePublicEvent(type, data, "workbench_server");
          events.push({ type, data });
        },
      } as never,
      async () => ({ text: largeSummary, generatedBy: "model" }),
    );

    const result = await service.compactConversation(
      "conv_test",
      {},
      {
        reason: "manual",
        activeConversation: { getStorage: () => storage } as never,
      },
    );

    assert.ok(result.entry.text.length > 16_384);
    const compacted = events.find(
      (event) => event.type === "conversation.compacted",
    );
    assert.equal(
      (compacted?.data as { entryId?: string } | undefined)?.entryId,
      "entry_compaction",
    );
    assert.equal(
      events.some((event) => event.type === "conversation.compaction.failed"),
      false,
    );
  });

  it("publishes coalesced summary tail snapshots while summarizing", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const branch = [
      {
        type: "message",
        id: "entry_old",
        parentId: null,
        timestamp,
        message: {
          role: "user",
          content: "x".repeat(20_000),
          timestamp: Date.parse(timestamp),
        },
      },
      {
        type: "message",
        id: "entry_recent",
        parentId: "entry_old",
        timestamp,
        message: {
          role: "user",
          content: "continue",
          timestamp: Date.parse(timestamp),
        },
      },
    ];
    let activeLeafId = "entry_recent";
    const storage = {
      getLeafId: async () => activeLeafId,
      getPathToRoot: async () => branch,
      appendEntry: async (entry: { id: string }) => {
        activeLeafId = entry.id;
      },
    };
    const summary = structuredSummary();
    const service = new CompactionService(
      () => ({ id: "conv_test", projectId: "proj_test" }) as never,
      () => ({ id: "proj_test", dir: "/tmp/project" }) as never,
      async (input) =>
        ({
          ...input,
          id: "entry_compaction",
          parentEntryId: input.parentEntryId ?? null,
          kind: input.kind ?? "message",
          createdAt: input.createdAt ?? timestamp,
        }) as never,
      { openStorage: async () => storage } as never,
      async () => undefined,
      {
        publish: async (type: string, data: unknown) => {
          events.push({ type, data });
        },
      } as never,
      async ({ onProgress }) => {
        // First attempt streams a draft, then the structural repair restarts it.
        onProgress?.({ attempt: 1, text: "## Goal\ndraft" });
        onProgress?.({ attempt: 1, text: "## Goal\ndraft\nmore draft" });
        onProgress?.({ attempt: 2, text: summary.slice(0, 40) });
        onProgress?.({ attempt: 2, text: summary });
        return { text: summary, generatedBy: "model" };
      },
    );

    await service.compactConversation(
      "conv_test",
      {},
      {
        reason: "threshold",
        agentId: "agent_test",
        runId: "run_test",
        activeConversation: { getStorage: () => storage } as never,
      },
    );

    const progress = events
      .filter((event) => event.type === "conversation.compaction.progress")
      .map(
        (event) =>
          event.data as {
            sequence: number;
            attempt: number;
            preview: string;
            generatedLines: number;
            generatedChars: number;
            runId?: string;
          },
      );
    assert.ok(progress.length >= 3);
    assert.deepEqual(
      progress.map((snapshot) => snapshot.sequence),
      progress.map((_snapshot, index) => index + 1),
    );
    assert.deepEqual([progress[0].attempt, progress.at(-1)?.attempt], [1, 2]);
    assert.equal(progress[0].preview, "## Goal\ndraft");
    assert.equal(progress[0].runId, "run_test");
    for (const snapshot of progress) {
      assert.ok(snapshot.preview.split("\n").length <= 6);
    }
    const last = progress.at(-1);
    assert.equal(last?.generatedChars, summary.length);
    assert.equal(last?.generatedLines, summary.split("\n").length);
    assert.equal(last?.preview, summary.split("\n").slice(-6).join("\n"));

    const progressIndexes = events.flatMap((event, index) =>
      event.type === "conversation.compaction.progress" ? [index] : [],
    );
    const compactedIndex = events.findIndex(
      (event) => event.type === "conversation.compacted",
    );
    assert.ok(compactedIndex > (progressIndexes.at(-1) ?? -1));
  });

  it("aborts model summarization without creating a checkpoint", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    let appendCalls = 0;
    let summarizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      summarizationStarted = resolve;
    });
    const branch = [
      {
        type: "message",
        id: "entry_old",
        parentId: null,
        timestamp,
        message: {
          role: "user",
          content: "x".repeat(20_000),
          timestamp: Date.parse(timestamp),
        },
      },
      {
        type: "message",
        id: "entry_recent",
        parentId: "entry_old",
        timestamp,
        message: {
          role: "user",
          content: "continue",
          timestamp: Date.parse(timestamp),
        },
      },
    ];
    const storage = {
      getLeafId: async () => "entry_recent",
      getPathToRoot: async () => branch,
      appendEntry: async () => {
        throw new Error("checkpoint must not be appended");
      },
    };
    const service = new CompactionService(
      () => ({ id: "conv_test", projectId: "proj_test" }) as never,
      () => ({ id: "proj_test", dir: "/tmp/project" }) as never,
      async () => {
        appendCalls += 1;
        throw new Error("checkpoint must not be appended");
      },
      { openStorage: async () => storage } as never,
      async () => undefined,
      {
        publish: async (type: string, data: unknown) => {
          events.push({ type, data });
        },
      } as never,
      async ({ signal }) => {
        summarizationStarted();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
        return undefined;
      },
    );

    const compaction = service.compactConversation(
      "conv_test",
      {},
      {
        reason: "manual",
        activeConversation: { getStorage: () => storage } as never,
      },
    );
    await started;
    const cancellation = service.cancelCompaction("conv_test");
    const duplicateCancellation = service.cancelCompaction("conv_test");
    await assert.rejects(compaction, /Compaction cancelled/);
    assert.equal(await cancellation, true);
    assert.equal(await duplicateCancellation, true);

    assert.equal(appendCalls, 0);
    assert.equal(await service.cancelCompaction("conv_test"), false);
    assert.equal(
      events.filter(
        (event) => event.type === "conversation.compaction.cancelled",
      ).length,
      1,
    );
    assert.equal(
      events.some((event) => event.type === "conversation.compaction.failed"),
      false,
    );
  });
});
