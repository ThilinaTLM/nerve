import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentAsyncObligation,
  AgentRecord,
  AsyncSubagentAssignment,
} from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { AgentAsyncObligationRuntime } from "../../../src/domains/agents/agent-async-obligation-runtime.js";
import type {
  AgentAsyncObligationRepository,
  AgentAsyncObligationService,
} from "../../../src/domains/agents/agent-async-obligation.service.js";

const createdAt = "2026-09-27T10:00:00.000Z";

function promotedTask(): TaskRecord {
  return {
    id: "task_promoted",
    conversationId: "conv_lead",
    agentId: "agent_lead",
    cwd: "/tmp",
    command: "build",
    status: "completed",
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/stdout",
    stderrPath: "/tmp/stderr",
    logsPath: "/tmp/logs",
    startedAt: createdAt,
    updatedAt: "2026-09-27T10:01:00.000Z",
    origin: { kind: "agent_tool", toolCallId: "tool_promoted" },
    completion: { inject: false, outputTailLineCount: 80 },
    notifications: {
      enabled: true,
      ready: true,
      terminal: false,
      outputTailLineCount: 80,
    },
    visibility: "background",
  };
}

function terminalRun(runId: string): RunRecord {
  return {
    stateEpoch: 1,
    conversationId: "conv_child",
    agentId: "agent_child",
    projectId: "proj_test",
    runId,
    scopeId: "conv_child:agent_child",
    revision: 2,
    status: "failed",
    recoverability: "none",
    executionId: "exec_test",
    attempt: 1,
    createdAt,
    updatedAt: "2026-09-27T10:02:00.000Z",
    terminalAt: "2026-09-27T10:02:00.000Z",
    cancellationEvidence: [],
  };
}

function recoverableRun(runId: string): RunRecord {
  return {
    ...terminalRun(runId),
    status: "interrupted",
    recoverability: "checkpoint",
  };
}

test("runtime reconstructs missing sources and restart is idempotent", async () => {
  const task = promotedTask();
  const assignments: AsyncSubagentAssignment[] = [
    {
      runId: "run_failed",
      childId: "agent_child",
      leadId: "agent_lead",
      generation: 3,
      childGeneration: 1,
    },
    {
      runId: "run_launch_failed",
      childId: "agent_child",
      leadId: "agent_lead",
      generation: 3,
      childGeneration: 1,
    },
    {
      runId: "run_recoverable",
      childId: "agent_child",
      leadId: "agent_lead",
      generation: 3,
      childGeneration: 1,
    },
  ];
  const records = new Map<string, AgentAsyncObligation>();
  const registrationCounts = new Map<string, number>();
  const readinessCounts = new Map<string, number>();
  const repository: AgentAsyncObligationRepository = {
    register: async (obligation) => {
      registrationCounts.set(
        obligation.id,
        (registrationCounts.get(obligation.id) ?? 0) + 1,
      );
      const existing = records.get(obligation.id);
      if (existing) return existing;
      records.set(obligation.id, obligation);
      return obligation;
    },
    get: async (id) => records.get(id),
    listByStates: async (states) =>
      [...records.values()].filter((record) => states.includes(record.state)),
    transition: async (id, expected, patch) => {
      const current = records.get(id)!;
      if (!expected.includes(current.state)) return current;
      const replacement = { ...current, ...patch };
      records.set(id, replacement);
      return replacement;
    },
  };
  const service = {
    start() {},
    async stop() {},
    register: (obligation: AgentAsyncObligation) =>
      repository.register(obligation),
    async markReady(
      id: string,
      outcome: string,
      completion?: AgentAsyncObligation["completion"],
    ) {
      readinessCounts.set(id, (readinessCounts.get(id) ?? 0) + 1);
      return repository.transition(id, ["pending"], {
        state: "ready",
        outcome,
        completion,
        updatedAt: "2026-09-27T10:03:00.000Z",
      });
    },
    async recover() {},
  } as unknown as AgentAsyncObligationService;
  const runs = new Map<string, RunRecord>([
    ["run_failed", terminalRun("run_failed")],
    ["run_recoverable", recoverableRun("run_recoverable")],
  ]);
  const runtime = () =>
    new AgentAsyncObligationRuntime({
      service,
      repository,
      events: { subscribe: () => () => undefined },
      getTask: () => task,
      listTasks: () => [task],
      getRun: async (id) => runs.get(id),
      completion: async (run) => ({
        agentId: run.agentId,
        runId: run.runId,
        attemptId: `${run.executionId}:${run.attempt}`,
        outcome: "failed",
        completedAt: run.updatedAt,
      }),
      listAssignments: async () => assignments,
      getAgent: () =>
        ({ id: "agent_lead", conversationId: "conv_lead" }) as AgentRecord,
      now: () => createdAt,
    });

  const first = runtime();
  await first.start();
  await first.stop();

  assert.deepEqual([...records.keys()].sort(), [
    "async_subagent:run_failed:3",
    "async_subagent:run_launch_failed:3",
    "async_subagent:run_recoverable:3",
    "promoted_task:task_promoted:0",
  ]);
  assert.equal(
    records.get("promoted_task:task_promoted:0")?.notificationEntryId,
    "entry_task_promoted_completion",
  );
  assert.equal(
    records.get("async_subagent:run_failed:3")?.notificationEntryId,
    "entry_subagent_failed_3",
  );
  assert.equal(records.get("promoted_task:task_promoted:0")?.state, "ready");
  assert.equal(records.get("async_subagent:run_failed:3")?.outcome, "failed");
  assert.equal(
    records.get("async_subagent:run_launch_failed:3")?.outcome,
    "launch_failed",
  );
  assert.equal(
    records.get("async_subagent:run_recoverable:3")?.state,
    "pending",
  );

  const restarted = runtime();
  await restarted.start();
  await restarted.stop();
  assert.equal(
    records.get("async_subagent:run_failed:3")?.completion?.runId,
    "run_failed",
  );
  assert.equal(
    records.get("async_subagent:run_failed:3")?.completion?.attemptId,
    "exec_test:1",
  );
  for (const count of registrationCounts.values()) assert.equal(count, 1);
  for (const count of readinessCounts.values()) assert.equal(count, 1);
});
