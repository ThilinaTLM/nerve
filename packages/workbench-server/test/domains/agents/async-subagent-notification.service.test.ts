import assert from "node:assert/strict";
import { it } from "node:test";
import {
  agentRecordSchema,
  type AsyncSubagentCompletion,
  type AsyncSubagentAssignment,
} from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { RunHydratedState } from "../../../src/domains/runs/runtime/run-unit-of-work.js";
import { newRun } from "../../../src/domains/runs/runtime/run-transitions.js";
import {
  AsyncSubagentNotificationService,
  type AsyncSubagentNotificationPorts,
} from "../../../src/domains/agents/async-subagent-notification.service.js";

function setup() {
  const now = new Date().toISOString();
  const lead = agentRecordSchema.parse({
    id: "agent_lead",
    rootAgentId: "agent_lead",
    projectId: "proj_team",
    projectDir: "/tmp/team",
    conversationId: "conv_team",
    mode: "coding",
    permissionLevel: "autonomous",
    status: "idle",
    workspaceScope: { roots: ["/tmp/team"] },
    createdAt: now,
    updatedAt: now,
  });
  const child = {
    ...lead,
    id: "agent_child",
    parentAgentId: lead.id,
    conversationId: "conv_child",
    name: "API",
    executionKind: "async_developer" as const,
  };
  const assignment: AsyncSubagentAssignment = {
    runId: "run_child",
    childId: child.id,
    leadId: lead.id,
    generation: 0,
    childGeneration: 0,
  };
  const run = {
    ...newRun(
      { ...lead, agentId: child.id, runId: assignment.runId },
      "child",
      now,
      { next: () => "test" },
    ),
    status: "completed" as const,
  };
  const childState: RunHydratedState = {
    run,
    transitions: [],
    prompts: [],
    interactions: [],
    checkpoints: [],
    deliveries: [],
  };
  const records = new Map<string, AsyncSubagentCompletion>();
  const entries: ConversationEntry[] = [];
  const childEntries: ConversationEntry[] = [];
  const queued: string[] = [];
  const queuedMessages: Array<{
    content: string;
    details?: { childId?: string };
  }> = [];
  let active: RunHydratedState | undefined;
  let generation = 0;
  let wakeCount = 0;
  let failWake = false;
  const ports: AsyncSubagentNotificationPorts = {
    repository: {
      control: async (id) => ({
        agentId: id,
        generation,
        stopped: false,
        stopping: false,
      }),
      assignments: async () => [assignment],
      store: {
        listSubagentCompletions: async () => [...records.values()],
        putSubagentCompletion: async (record) => {
          records.set(record.runId, {
            ...records.get(record.runId),
            ...record,
          });
        },
      },
    },
    runs: { load: async () => childState, findActive: async () => active },
    live: {
      get: (id) =>
        id === active?.run.runId
          ? {
              enqueueHarnessMessage: async (input) => {
                queued.push(input.id);
                queuedMessages.push(input.message);
              },
            }
          : undefined,
    },
    events: { subscribe: () => () => {} },
    harnessStorage: {
      appendHarnessMessageWithId: async (_agent, id, _message, timestamp) => ({
        id,
        timestamp: timestamp ?? now,
      }),
    },
    getAgent: (id) => (id === lead.id ? lead : child),
    entries: async (conversationId) =>
      conversationId === child.conversationId ? childEntries : entries,
    appendEntry: async (input) => {
      const entry = {
        ...input,
        id: input.id!,
        createdAt: input.createdAt!,
        kind: input.kind ?? "message",
      } as ConversationEntry;
      entries.push(entry);
      return entry;
    },
    enabled: async () => true,
    wake: async () => {
      if (failWake) throw new Error("wake failed");
      wakeCount++;
      active = {
        ...childState,
        run: { ...run, agentId: lead.id, runId: "run_lead", status: "running" },
      };
    },
    reconcile: async () => {},
    warn: () => {},
  };
  const service = new AsyncSubagentNotificationService(ports);
  service.start();
  return {
    service,
    records,
    entries,
    childEntries,
    queued,
    queuedMessages,
    lead,
    child,
    childState,
    wakeCount: () => wakeCount,
    failWake: (value: boolean) => {
      failWake = value;
    },
    stopGeneration: () => {
      generation++;
    },
    activate: () => {
      active = {
        ...childState,
        run: { ...run, runId: "run_lead", agentId: lead.id, status: "running" },
      };
    },
    idle: () => {
      active = undefined;
    },
  };
}

it("recovers a missing completion row, persists before waking, and does not wake repeatedly", async () => {
  const f = setup();
  await f.service.recover();
  assert.equal(f.records.size, 1);
  assert.equal(f.entries.length, 1);
  assert.match(
    f.entries[0]?.text ?? "",
    /teammate API finished assignment: completed/,
  );
  assert.doesNotMatch(
    f.entries[0]?.text ?? "",
    /agent_child|run_child|subagent_status/,
  );
  assert.equal(f.entries[0]?.details?.childId, f.child.id);
  assert.equal(f.wakeCount(), 1);
  await f.service.recover();
  assert.equal(f.wakeCount(), 1);
  f.idle();
  await f.service.recover();
  assert.equal(
    f.wakeCount(),
    1,
    "a failed lead turn must not create an infinite automatic wake loop",
  );
  await f.service.stop();
});

it("queues into an active lead without marking the notification delivered before acknowledgment", async () => {
  const f = setup();
  f.activate();
  await f.service.recover();
  await f.service.recover();
  assert.equal(f.queued.length, 1);
  assert.match(
    f.queuedMessages[0]?.content ?? "",
    /teammate API finished assignment: completed/,
  );
  assert.doesNotMatch(
    f.queuedMessages[0]?.content ?? "",
    /agent_child|run_child|subagent_status/,
  );
  assert.equal(f.queuedMessages[0]?.details?.childId, f.child.id);
  assert.equal(f.wakeCount(), 0);
  assert.equal([...f.records.values()][0]?.deliveredAt, undefined);
  f.idle();
  await f.service.recover();
  assert.equal(
    f.entries.length,
    1,
    "a dropped live queue must fall back to durable append after teardown",
  );
  assert.equal(f.wakeCount(), 1);
  await f.service.stop();
});

it("delivers the response for the completed assignment rather than an earlier run", async () => {
  const f = setup();
  f.childEntries.push(
    {
      id: "entry_old",
      agentId: f.child.id,
      runId: "run_old",
      role: "assistant",
      text: "Stale response",
    } as ConversationEntry,
    {
      id: "entry_final",
      agentId: f.child.id,
      runId: "run_child",
      role: "assistant",
      text: "Implemented the requested change.",
    } as ConversationEntry,
  );
  f.activate();
  await f.service.recover();
  assert.match(
    f.queuedMessages[0]?.content ?? "",
    /Final response:\nImplemented the requested change\./,
  );
  assert.doesNotMatch(f.queuedMessages[0]?.content ?? "", /Stale response/);
  await f.service.stop();
});

it("labels a failed assignment's response as incomplete", async () => {
  const f = setup();
  f.childState.run = { ...f.childState.run, status: "failed" };
  f.childEntries.push({
    id: "entry_partial",
    agentId: f.child.id,
    runId: "run_child",
    role: "assistant",
    text: "Partial findings",
  } as ConversationEntry);
  await f.service.recover();
  assert.match(f.entries[0]?.text ?? "", /finished assignment: failed/);
  assert.match(
    f.entries[0]?.text ?? "",
    /Last response \(assignment did not complete\):\nPartial findings/,
  );
  await f.service.stop();
});

it("retries a failed wake without duplicating the conversation entry", async () => {
  const f = setup();
  f.failWake(true);
  await assert.rejects(f.service.recover(), /wake failed/);
  assert.equal(f.entries.length, 1);
  f.failWake(false);
  await f.service.recover();
  assert.equal(f.entries.length, 1);
  assert.equal(f.wakeCount(), 1);
  await f.service.stop();
});

it("suppresses late completions from a stopped team generation", async () => {
  const f = setup();
  f.stopGeneration();
  await f.service.recover();
  assert.equal([...f.records.values()][0]?.suppressed, true);
  assert.equal(f.entries.length, 0);
  assert.equal(f.wakeCount(), 0);
  await f.service.stop();
});
