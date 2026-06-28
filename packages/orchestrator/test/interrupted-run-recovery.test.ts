import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ConversationEntry, EventEnvelope } from "@nervekit/shared";
import { recoverInterruptedRuns } from "../src/domains/agents/run/interrupted-run-recovery.js";
import type { AppendEntryFn } from "../src/domains/agents/run/message-mirror.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { ApplicationLogger } from "../src/infrastructure/diagnostics/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-run-recovery-"));
  roots.push(root);
  return root;
}

type AppendCall = Parameters<AppendEntryFn>[0];

function recordingAppendEntry(calls: AppendCall[]): AppendEntryFn {
  return async (input) => {
    calls.push(input);
    return {
      id: input.id ?? `entry_${calls.length}`,
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      role: input.role,
      kind: input.kind ?? "message",
      text: input.text,
      details: input.details,
      createdAt: input.createdAt ?? new Date().toISOString(),
    } as ConversationEntry;
  };
}

function event(
  seq: number,
  type: string,
  data: Record<string, unknown>,
): EventEnvelope {
  return {
    seq,
    id: `evt_${seq}`,
    ts: new Date().toISOString(),
    type,
    durability: "durable",
    data,
  };
}

describe("recoverInterruptedRuns", () => {
  it("fails runs that started but never reached a terminal event", async () => {
    const home = await tempHome();
    const bus = new EventBus(home);
    const logger = new ApplicationLogger({
      dataDir: home,
      mirrorToConsole: false,
    });
    await logger.hydrate();

    const failed: EventEnvelope[] = [];
    const appended: EventEnvelope[] = [];
    bus.subscribe((evt) => {
      if (evt.type === "conversation.run.failed") failed.push(evt);
      if (evt.type === "conversation.entry.appended") appended.push(evt);
    });
    const appendCalls: AppendCall[] = [];
    const terminatedRunIds: string[] = [];
    const tools = {
      terminateNonTerminalToolCallsForRun: async (runId: string) => {
        terminatedRunIds.push(runId);
        return [];
      },
    };

    const events: EventEnvelope[] = [
      event(1, "conversation.run.started", {
        runId: "run_done",
        agentId: "agent_a",
        projectId: "proj_a",
        conversationId: "conv_a",
      }),
      event(2, "conversation.run.completed", { runId: "run_done" }),
      event(3, "conversation.run.started", {
        runId: "run_stuck",
        agentId: "agent_b",
        projectId: "proj_b",
        conversationId: "conv_b",
      }),
      event(4, "conversation.run.started", {
        runId: "run_suspended",
        agentId: "agent_c",
      }),
      event(5, "conversation.run.suspended", { runId: "run_suspended" }),
    ];

    const recovered = await recoverInterruptedRuns(events, {
      events: bus,
      logger,
      tools,
      appendEntry: recordingAppendEntry(appendCalls),
    });

    assert.equal(recovered, 1);
    assert.equal(failed.length, 1);
    const data = failed[0]?.data as Record<string, unknown>;
    assert.equal(data.runId, "run_stuck");
    assert.equal(data.conversationId, "conv_b");
    assert.equal(data.aborted, true);
    assert.equal(data.interrupted, true);
    assert.deepEqual(terminatedRunIds, ["run_stuck"]);

    // A continuable `interrupted` run_status entry is persisted at the leaf.
    assert.equal(appendCalls.length, 1);
    const statusInput = appendCalls[0];
    assert.equal(statusInput?.conversationId, "conv_b");
    assert.equal(statusInput?.kind, "run_status");
    assert.equal("parentEntryId" in (statusInput ?? {}), false);
    const statusDetails = statusInput?.details as Record<string, unknown>;
    assert.equal(statusDetails.type, "agent_run_retry_status");
    assert.equal(statusDetails.state, "interrupted");
    assert.equal(statusDetails.retryable, true);
    assert.equal(statusDetails.runId, "run_stuck");
    assert.equal(appended.length, 1);
    const appendedEntry = (appended[0]?.data as Record<string, unknown>)
      .entry as Record<string, unknown>;
    assert.equal(appendedEntry.kind, "run_status");
  });

  it("does nothing when all runs already reached a terminal state", async () => {
    const home = await tempHome();
    const bus = new EventBus(home);
    const logger = new ApplicationLogger({
      dataDir: home,
      mirrorToConsole: false,
    });
    await logger.hydrate();

    const events: EventEnvelope[] = [
      event(1, "conversation.run.started", { runId: "run_1" }),
      event(2, "conversation.run.failed", { runId: "run_1" }),
    ];

    const terminatedRunIds: string[] = [];
    const appendCalls: AppendCall[] = [];
    const recovered = await recoverInterruptedRuns(events, {
      events: bus,
      logger,
      tools: {
        terminateNonTerminalToolCallsForRun: async (runId: string) => {
          terminatedRunIds.push(runId);
          return [];
        },
      },
      appendEntry: recordingAppendEntry(appendCalls),
    });
    assert.equal(recovered, 0);
    assert.deepEqual(terminatedRunIds, []);
    assert.equal(appendCalls.length, 0);
  });
});
