import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ApprovalSettlement,
  ConversationEntry,
} from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type { RunInteractionRecord } from "@nervekit/contracts/runs";
import {
  ConversationJournalRepository,
  ConversationJournalRevisionConflictError,
} from "../../../src/domains/conversations/conversation-journal.repository.js";
import { ApprovalSettlementRepository } from "../../../src/domains/human-input/approval-settlement.repository.js";
import { ApprovalSettlementService } from "../../../src/domains/human-input/approval-settlement.service.js";
import { ToolCallRepository } from "../../../src/domains/tools/artifacts/tool-call.repository.js";
import { WorkbenchRunIntegrity } from "../../../src/domains/runs/adapters/workbench-run-integrity.js";
import {
  buildTransition,
  newRun,
} from "../../../src/domains/runs/runtime/run-transitions.js";

const now = "2026-09-05T06:00:00.000Z";
const integrity = new WorkbenchRunIntegrity();
const ids = { next: () => "fixture" };

function draft(id: string): ToolCallRecord {
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    runId: "run_test",
    toolName: "bash",
    risk: "command",
    args: { command: "echo test" },
    cwd: "/tmp",
    status: "waiting",
    phase: "drafted",
    revision: 1,
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    supervision: {
      status: "pending",
      source: "policy",
      decision: {
        version: 1,
        decision: "prompt",
        effectiveRisk: "command",
        reason: "test",
        normalizedArgs: { command: "echo test" },
        normalizedTargets: [],
        matchedRuleIds: [],
        policySnapshotHash: `sha256:${"0".repeat(64)}`,
        suggestedRules: [],
      },
    },
    interactions: [
      {
        ordinal: 0,
        kind: "approval",
        status: "pending",
        requestedAt: now,
        updatedAt: now,
        request: {
          risk: "command",
          reason: "test",
          offeredScopes: ["single_call"],
          suggestedExceptions: [],
          suggestedRules: [],
        },
      },
    ],
  } as ToolCallRecord;
}

async function fixture(t: test.TestContext, count = 1) {
  const home = await mkdtemp(join(tmpdir(), "nerve-approval-settlement-"));
  const journal = new ConversationJournalRepository({ paths: { home } });
  t.after(async () => {
    await journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const tools = new ToolCallRepository(journal);
  const repository = new ApprovalSettlementRepository(journal);
  const calls = Array.from({ length: count }, (_, index) =>
    draft(`tool_${index}`),
  );
  for (const call of calls) await tools.create(call);
  const entry: ConversationEntry = {
    id: "entry_anchor",
    conversationId: "conv_test",
    agentId: "agent_test",
    runId: "run_test",
    role: "assistant",
    kind: "message",
    text: "Tools",
    createdAt: now,
  };
  const run = {
    ...newRun(
      {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        prompt: "test",
      },
      "scope_test",
      now,
      ids,
    ),
    status: "waiting" as const,
    activeInteractionId: "tool_0:0",
    lastCheckpointId: "checkpoint_test",
  };
  const interactions: RunInteractionRecord[] = calls.map((call) => ({
    stateEpoch: 1,
    id: `${call.id}:0`,
    conversationId: call.conversationId,
    agentId: call.agentId,
    projectId: call.projectId,
    runId: "run_test",
    executionId: run.executionId,
    toolCallId: call.id,
    interactionOrdinal: 0,
    toolCallRevision: 1,
    kind: "approval",
    status: "pending",
    checkpointId: "checkpoint_test",
    createdAt: now,
    ...(count > 1 ? { batchToolCallIds: calls.map((item) => item.id) } : {}),
  }));
  const checkpointBase = {
    stateEpoch: 1 as const,
    checkpointId: "checkpoint_test",
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: run.runId,
    executionId: run.executionId,
    attempt: 1,
    boundary: "suspension" as const,
    transcriptCursor: 1,
    entryIds: [entry.id],
    harnessLeafId: entry.id,
    harnessSavePointId: "savepoint_test",
    toolCalls: calls.map((call) => ({
      toolCallId: call.id,
      revision: 1,
      status: call.status,
    })),
    interactionId: interactions[0]!.id,
    createdAt: now,
    committed: true as const,
  };
  await journal.commit("conv_test", {
    kind: "fixture",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_test",
        conversation: {
          id: "conv_test",
          projectId: "proj_test",
          title: "test",
          mode: "coding",
          permissionLevel: "supervised",
          activeEntryId: entry.id,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        kind: "model_context.entry_appended",
        conversationId: "conv_test",
        entry: {
          type: "message",
          id: entry.id,
          parentId: null,
          timestamp: now,
          message: {
            role: "user",
            content: "test",
            timestamp: Date.parse(now),
          },
        },
      },
      {
        kind: "conversation.entry_appended",
        conversationId: "conv_test",
        entry,
      },
      {
        kind: "run.transition_committed",
        conversationId: "conv_test",
        transition: buildTransition(
          run,
          "waiting",
          0,
          {
            entries: [entry],
            interactions,
            checkpoints: [
              {
                ...checkpointBase,
                checksum: integrity.checksum(checkpointBase),
              },
            ],
          },
          ids,
          integrity,
        ),
      },
    ],
  });
  async function accept(index = 0) {
    const current = tools.get(calls[index]!.id);
    await tools.replace(
      current.id,
      current.revision,
      (record) => ({
        ...record,
        status: "committed",
        updatedAt: now,
        supervision: {
          ...record.supervision!,
          status: "approved",
          source: "user",
          decidedAt: now,
        },
        interactions: record.interactions.map((item) => ({
          ...item,
          status: "resolved",
          resolvedAt: now,
          resolutionRequestId: `request_${index}`,
          resolution: { action: "allow", scope: "single_call" },
        })) as ToolCallRecord["interactions"],
      }),
      (state, next) => repository.acceptanceEvents(state, next),
    );
    return (await repository.list())[0]!;
  }
  let executions = 0;
  let continuations = 0;
  let projectionCalls = 0;
  let beforeExecute: (() => Promise<void>) | undefined;
  let beforeContinue: (() => Promise<void>) | undefined;
  const worker = new ApprovalSettlementService({
    repository,
    tools: {
      listApprovals: () => [],
      getToolCallDetails: (id: string) => tools.getCanonical(id),
      getApprovalForToolCallDetails: async (id: string) => ({
        id,
        status: "granted",
      }),
      finalizeDecidedApproval: async (id: string) => {
        await beforeExecute?.();
        const current = tools.get(id);
        await tools.replace(id, current.revision, (record) => ({
          ...record,
          status: "running",
          phase: "executing",
          attempt: 1,
        }));
        executions++;
        return tools.replace(id, tools.get(id).revision, (record) => ({
          ...record,
          status: "completed",
          phase: "completed",
          result: { stdout: "ok" },
          settledAt: now,
        }));
      },
    },
    runs: {
      listApprovalRecoveryInteractions: async () => [],
      observeApprovalCommit: async () => undefined,
      continueApprovalSettlement: async (value: ApprovalSettlement) => {
        await beforeContinue?.();
        continuations++;
        await repository.update(
          value,
          { phase: "completed" },
          {
            status: "running",
            executionId: "exec_resumed",
            attempt: 2,
            approvalSettlementId: undefined,
          },
        );
      },
    },
    logger: { error: async () => undefined },
    reconcileConversationProjection: () => {
      projectionCalls++;
    },
  } as never);
  t.after(() => worker.stop());
  return {
    home,
    journal,
    repository,
    tools,
    calls,
    accept,
    worker,
    get executions() {
      return executions;
    },
    get continuations() {
      return continuations;
    },
    get projectionCalls() {
      return projectionCalls;
    },
    set beforeExecute(value: (() => Promise<void>) | undefined) {
      beforeExecute = value;
    },
    set beforeContinue(value: (() => Promise<void>) | undefined) {
      beforeContinue = value;
    },
  };
}

test("acceptance commits the decision, run interaction, and owed work in one revision and replays", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  const state = await f.journal.load("conv_test");
  assert.equal(value.phase, "ready");
  assert.equal(state.runProjections.get("run_test")?.run.status, "settling");
  assert.equal(
    state.runProjections.get("run_test")?.interactions[0]?.status,
    "resolved",
  );
  assert.equal(state.toolCalls.get("tool_0")?.attempt, 0);
  await f.journal.checkpointLoaded();
  const replay = new ConversationJournalRepository({ paths: { home: f.home } });
  try {
    assert.deepEqual(
      (await replay.load("conv_test")).approvalSettlements.get(value.id),
      value,
    );
    assert.deepEqual(await replay.listApprovalSettlements(), [value]);
  } finally {
    await replay.close();
  }
});

test("a failed acceptance transaction leaves no accepted decision or work", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.tools.replace(
      "tool_0",
      1,
      (record) => ({ ...record, interactions: [] }),
      () => {
        throw new Error("injected commit failure");
      },
    ),
  );
  assert.equal(f.tools.get("tool_0").revision, 1);
  assert.equal((await f.repository.list()).length, 0);
  assert.equal(
    (await f.journal.load("conv_test")).toolCalls.get("tool_0")?.interactions[0]
      ?.status,
    "pending",
  );
});

test("partial batch decisions remain waiting; final acceptance settles ordered results once", async (t) => {
  const f = await fixture(t, 2);
  assert.equal((await f.accept(0)).phase, "awaiting_decisions");
  assert.equal(
    (await f.journal.load("conv_test")).runProjections.get("run_test")?.run
      .status,
    "waiting",
  );
  const value = await f.accept(1);
  await f.worker.process(value);
  await f.worker.process(value);
  assert.equal(f.executions, 2);
  assert.equal(f.continuations, 1);
  const state = await f.journal.load("conv_test");
  assert.deepEqual(
    state.entries
      .slice(1)
      .map((entry) => (entry.details as { toolRecordId: string }).toolRecordId),
    ["tool_0", "tool_1"],
  );
  assert.equal(state.modelEntries.length, 3);
});

test("persisted approval survives pre-claim failure and retries without another user decision", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  f.beforeExecute = async () => {
    throw new Error("temporary dependency unavailable");
  };
  await f.worker.process(value);
  const pending = (await f.repository.list())[0]!;
  assert.equal(pending.attempts, 1);
  assert.ok(pending.nextAttemptAt);
  assert.equal(f.tools.get("tool_0").attempt, 0);
  assert.equal(f.tools.get("tool_0").interactions[0]?.status, "resolved");
  f.beforeExecute = undefined;
  await f.worker.process(pending);
  assert.equal(f.executions, 1);
  assert.equal(f.continuations, 1);
});

test("failure before continuation never repeats terminal tools or transcript", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  f.beforeContinue = async () => {
    throw new Error("model unavailable");
  };
  await f.worker.process(value);
  const pending = (await f.repository.list())[0]!;
  assert.equal(pending.phase, "continuation_pending");
  assert.equal(f.executions, 1);
  f.beforeContinue = undefined;
  await f.worker.process(pending);
  assert.equal(f.executions, 1);
  assert.equal(f.continuations, 1);
  assert.equal((await f.journal.load("conv_test")).entries.length, 2);
});

test("canonical conversation projection is reconciled before continuation", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  f.beforeContinue = async () => {
    assert.equal(f.projectionCalls, 1);
  };
  await f.worker.process(value);
  assert.equal(f.projectionCalls, 1);
  assert.equal(f.continuations, 1);
});

test("a concurrent journal commit is retried immediately without consuming the failure budget", async (t) => {
  const f = await fixture(t);
  await f.accept();
  const update = f.repository.update.bind(f.repository);
  let conflicted = false;
  f.repository.update = async (value, patch, runPatch) => {
    if (!conflicted && patch.phase === "executing") {
      conflicted = true;
      throw new ConversationJournalRevisionConflictError("conv_test", 1, 2);
    }
    return update(value, patch, runPatch);
  };
  const completed = new Promise<void>((resolve) => {
    const unsubscribe = f.journal.onCommit((commit) => {
      if (
        commit.events.some(
          (event) =>
            event.kind === "approval_settlement.upserted" &&
            event.settlement.phase === "completed",
        )
      ) {
        unsubscribe();
        resolve();
      }
    });
  });
  await f.worker.start();
  await completed;
  assert.equal(conflicted, true);
  assert.equal(f.executions, 1);
  assert.equal(f.continuations, 1);
  assert.equal((await f.repository.list())[0]?.attempts, 0);
});

test("unknown claimed execution blocks instead of redispatching", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  await f.repository.update(value, { phase: "executing" });
  await f.tools.replace("tool_0", 2, (record) => ({
    ...record,
    status: "running",
    phase: "executing",
    attempt: 1,
  }));
  await f.worker.process(value);
  const blocked = (await f.repository.list())[0]!;
  assert.equal(blocked.phase, "blocked");
  assert.equal(blocked.failure?.code, "TOOL_EXECUTION_OUTCOME_UNKNOWN");
  assert.equal(f.executions, 0);
  assert.equal(f.continuations, 0);
});

test("changed branch blocks before dispatch and does not silently rebase", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  const state = await f.journal.load("conv_test");
  await f.journal.commit("conv_test", {
    kind: "branch.changed",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_test",
        conversation: { ...state.conversation!, activeEntryId: undefined },
      },
    ],
  });
  await f.worker.process(value);
  assert.equal((await f.repository.list())[0]?.phase, "blocked");
  assert.equal(f.executions, 0);
});

test("cancelling a blocked settlement terminalizes its obligation without dispatch", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  const state = await f.journal.load("conv_test");
  await f.journal.commit("conv_test", {
    kind: "branch.changed",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_test",
        conversation: { ...state.conversation!, activeEntryId: undefined },
      },
    ],
  });
  await f.worker.process(value);
  const blocked = (await f.repository.list())[0]!;
  const blockedState = await f.journal.load("conv_test");
  const projection = blockedState.runProjections.get("run_test")!;
  const cancellingRun = {
    ...projection.run,
    status: "cancellation_requested" as const,
    revision: projection.run.revision + 1,
    updatedAt: now,
  };
  await f.journal.commit(
    "conv_test",
    {
      kind: "run.cancellation_requested",
      events: [
        {
          kind: "run.transition_committed",
          conversationId: "conv_test",
          transition: buildTransition(
            cancellingRun,
            "cancellation_requested",
            projection.run.revision,
            {},
            ids,
            integrity,
          ),
        },
      ],
    },
    blockedState.revision,
  );
  await f.worker.process(blocked);
  assert.equal((await f.repository.list())[0]?.phase, "cancelled");
  assert.equal(f.executions, 0);
});

test("transient retry budget is durable and finite", async (t) => {
  const f = await fixture(t);
  let value = await f.accept();
  f.beforeExecute = async () => {
    throw new Error("dependency unavailable");
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    await f.worker.process(value);
    value = (await f.repository.list())[0]!;
  }
  assert.equal(value.phase, "blocked");
  assert.equal(value.attempts, 6);
  assert.equal(value.nextAttemptAt, undefined);
  assert.equal(f.executions, 0);
});

test("journal acceptance wakes daemon work without a request callback or snapshot", async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await f.worker.start();
  let done!: () => void;
  const completed = new Promise<void>((resolve) => {
    done = resolve;
  });
  const unsubscribe = f.journal.onCommit((commit) => {
    if (
      commit.events.some(
        (event) =>
          event.kind === "approval_settlement.upserted" &&
          event.settlement.phase === "completed",
      )
    )
      done();
  });
  t.after(unsubscribe);
  await f.accept(); // Deliberately no worker.wake(): the HTTP handler could die here.
  t.mock.timers.tick(0);
  await completed;
  assert.equal(f.executions, 1);
  assert.equal(f.continuations, 1);
});

test("old approved draft plus pending run interaction is normalized once", async (t) => {
  const f = await fixture(t);
  const accepted = await f.tools.replace("tool_0", 1, (tool) => ({
    ...tool,
    status: "committed",
    supervision: { ...tool.supervision!, status: "approved", source: "user" },
    interactions: [
      {
        ...tool.interactions[0]!,
        status: "resolved",
        resolvedAt: now,
        resolutionRequestId: "old-request",
        resolution: { action: "allow" },
      },
    ] as ToolCallRecord["interactions"],
  }));
  await f.repository.normalize("conv_test", accepted);
  const revision = (await f.journal.load("conv_test")).revision;
  await f.repository.normalize("conv_test", accepted);
  assert.equal((await f.journal.load("conv_test")).revision, revision);
  assert.equal((await f.repository.list())[0]?.phase, "ready");
});

test("cancellation fences execution even before tool terminalization runs", async (t) => {
  const f = await fixture(t);
  let value = await f.accept();
  value = await f.repository.update(value, { phase: "executing" });
  const state = await f.journal.load("conv_test");
  const run = state.runProjections.get("run_test")!.run;
  await f.journal.commit("conv_test", {
    kind: "cancel",
    events: [
      {
        kind: "run.transition_committed",
        conversationId: "conv_test",
        transition: buildTransition(
          {
            ...run,
            status: "cancellation_requested",
            revision: run.revision + 1,
          },
          "cancel",
          run.revision,
          {},
          ids,
          integrity,
        ),
      },
    ],
  });
  await assert.rejects(
    f.tools.replace("tool_0", 2, (tool) => ({
      ...tool,
      status: "running",
      phase: "executing",
      attempt: 1,
    })),
    /execution claim/,
  );
  await f.worker.process(value);
  assert.equal((await f.repository.list())[0]?.phase, "cancelled");
  assert.equal(f.executions, 0);
  assert.equal(f.continuations, 0);
});

test("concurrent execution claims have exactly one durable winner", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  await f.repository.update(value, { phase: "executing" });
  const claim = () =>
    f.tools.replace("tool_0", 2, (tool) => ({
      ...tool,
      status: "running",
      phase: "executing",
      attempt: 1,
    }));
  const results = await Promise.allSettled([claim(), claim()]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(f.tools.get("tool_0").attempt, 1);
});

test("journal rejects skipping execution and continuation phases", async (t) => {
  const f = await fixture(t);
  const value = await f.accept();
  await assert.rejects(
    f.repository.update(
      value,
      { phase: "completed" },
      {
        status: "running",
        executionId: "exec_resumed",
        approvalSettlementId: undefined,
      },
    ),
    /phase transition/,
  );
  assert.equal((await f.repository.list())[0]?.phase, "ready");
});

test("legacy history-only tool result blocks rather than omitting model context", async (t) => {
  const f = await fixture(t);
  let value = await f.accept();
  value = await f.repository.update(value, { phase: "executing" });
  await f.tools.replace("tool_0", 2, (tool) => ({
    ...tool,
    status: "running",
    phase: "executing",
    attempt: 1,
  }));
  await f.tools.replace("tool_0", 3, (tool) => ({
    ...tool,
    status: "completed",
    phase: "completed",
    result: { stdout: "already done" },
    settledAt: now,
  }));
  const state = await f.journal.load("conv_test");
  const entry: ConversationEntry = {
    id: "entry_partial",
    conversationId: "conv_test",
    agentId: "agent_test",
    runId: "run_test",
    parentEntryId: "entry_anchor",
    role: "system",
    kind: "message",
    text: "result",
    details: { toolRecordId: "tool_0" },
    createdAt: now,
  };
  await f.journal.commit("conv_test", {
    kind: "legacy.partial",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId: "conv_test",
        entry,
      },
      {
        kind: "conversation.upserted",
        conversationId: "conv_test",
        conversation: { ...state.conversation!, activeEntryId: entry.id },
      },
    ],
  });
  await f.worker.process(value);
  assert.equal((await f.repository.list())[0]?.phase, "blocked");
  assert.equal(
    (await f.repository.list())[0]?.failure?.code,
    "RUN_CHECKPOINT_STALE",
  );
  assert.equal(f.executions, 0);
  assert.equal(f.continuations, 0);
});
