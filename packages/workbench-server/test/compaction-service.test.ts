import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompactionService } from "../src/domains/conversations/operations/compaction-service.js";

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
  it("forwards the summary budget and records model provenance and policy", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    let summarizerBudget = 0;
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
    const appendedHarness: unknown[] = [];
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
        openStorage: async () => ({
          getLeafId: async () => "entry_recent",
          getPathToRoot: async () => branch,
          appendEntry: async (entry: unknown) => {
            appendedHarness.push(entry);
          },
        }),
      } as never,
      async () => undefined,
      {
        publish: async (type: string, data: unknown) => {
          events.push({ type, data });
        },
      } as never,
      async (input) => {
        summarizerBudget = input.summaryReserveTokens;
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
      },
    );

    assert.equal(summarizerBudget, 8_000);
    const details = result.entry.details as {
      generatedBy?: string;
      policy?: Record<string, unknown>;
      freedTokens?: number;
    };
    assert.equal(details.generatedBy, "model");
    assert.equal(details.policy?.profile, "balanced");
    assert.equal(details.policy?.summaryReserveTokens, 8_000);
    assert.ok((details.freedTokens ?? 0) > 0);
    assert.equal(appendedHarness.length, 1);
    assert.ok(
      events.some((event) => event.type === "conversation.compaction.started"),
    );
    assert.ok(events.some((event) => event.type === "conversation.compacted"));
  });
});
