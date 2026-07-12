import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  RunEventDeliveryRecord,
  RunPublicEventIntent,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  RunConflictError,
  RunCoordinator,
  RunEventDeliveryService,
  reduceRunTransitions,
  type RunExecution,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "../src/index.js";

class MemoryUnitOfWork implements RunUnitOfWorkPort {
  transitions = new Map<string, RunTransitionRecord[]>();
  deliveries = new Map<string, RunEventDeliveryRecord[]>();
  materializeFailure?: Error;

  async load(runId: string): Promise<RunHydratedState | undefined> {
    return reduceRunTransitions(
      this.transitions.get(runId) ?? [],
      this.deliveries.get(runId) ?? [],
    );
  }
  async findActive(scopeId: string) {
    return (await this.list()).find(
      (item) =>
        item.run.scopeId === scopeId &&
        !["completed", "failed", "cancelled"].includes(item.run.status),
    );
  }
  async list() {
    return (
      await Promise.all([...this.transitions.keys()].map((id) => this.load(id)))
    ).filter((item): item is RunHydratedState => Boolean(item));
  }
  async commit(expectedRevision: number, transition: RunTransitionRecord) {
    const current = await this.load(transition.runId);
    assert.equal(current?.run.revision ?? 0, expectedRevision);
    this.transitions.set(transition.runId, [
      ...(this.transitions.get(transition.runId) ?? []),
      structuredClone(transition),
    ]);
  }
  async pendingEventIntents() {
    const pending = [];
    for (const state of await this.list()) {
      const delivered = new Set(state.deliveries.map((item) => item.intentId));
      for (const transition of state.transitions) {
        for (const intent of transition.events) {
          if (!delivered.has(intent.id)) {
            pending.push({
              runId: state.run.runId,
              revision: transition.revision,
              intent,
            });
          }
        }
      }
    }
    return pending;
  }
  async markEventDelivered(delivery: RunEventDeliveryRecord) {
    const existing = this.deliveries.get(delivery.runId) ?? [];
    if (!existing.some((item) => item.intentId === delivery.intentId)) {
      this.deliveries.set(delivery.runId, [...existing, delivery]);
    }
  }
  async materialize() {
    if (this.materializeFailure) throw this.materializeFailure;
  }
}

function fixture(
  options: {
    cancelToolsFails?: boolean;
    publicationFails?: boolean;
  } = {},
) {
  const unitOfWork = new MemoryUnitOfWork();
  const published = new Map<string, { eventId: string; sequence: number }>();
  const controls: Array<{ behavior: string; text: string }> = [];
  const executions: RunExecution[] = [];
  let id = 0;
  let finishExecution!: (value: { status: "completed" }) => void;
  const executeResult = new Promise<{ status: "completed" }>((resolve) => {
    finishExecution = resolve;
  });
  let transcript = {
    cursor: 0,
    entryIds: [] as string[],
    harnessLeafId: null as string | null,
    harnessSavePointId: "save_0",
  };
  const delivery = new RunEventDeliveryService(
    unitOfWork,
    {
      publish: async (intent) => {
        if (options.publicationFails) throw new Error("journal unavailable");
        const existing = published.get(intent.id);
        if (existing) return existing;
        const value = { eventId: intent.id, sequence: published.size + 1 };
        published.set(intent.id, value);
        return value;
      },
    },
    () => "2026-07-12T00:00:59.000Z",
  );
  const coordinator = new RunCoordinator({
    unitOfWork,
    execution: {
      create: async () => {
        const execution: RunExecution = {
          control: {
            steer: async (prompt) => {
              controls.push({ behavior: prompt.behavior, text: prompt.text });
            },
            followUp: async (prompt) => {
              controls.push({ behavior: prompt.behavior, text: prompt.text });
            },
            continue: async () => undefined,
            cancel: async () => undefined,
          },
          execute: async () => executeResult,
        };
        executions.push(execution);
        return execution;
      },
    },
    references: {
      stateEpoch: () => 1,
      transcript: async () => transcript,
      toolCalls: async () => [],
      interaction: async (interactionId) => {
        for (const state of await unitOfWork.list()) {
          const found = state.interactions.find(
            (item) => item.id === interactionId,
          );
          if (found) return found;
        }
        return undefined;
      },
    },
    cancellation: {
      cancelModel: async () => "confirmed",
      cancelTools: async () => {
        if (options.cancelToolsFails) throw new Error("tool still running");
        return "confirmed";
      },
      cancelTasks: async () => "not_running",
      cancelSubagents: async () => "not_running",
      cancelInteraction: async () => "not_running",
    },
    clock: {
      now: () =>
        new Date(`2026-07-12T00:00:${String(id).padStart(2, "0")}.000Z`),
    },
    ids: { next: () => String(++id) },
    integrity: { checksum },
    flushEvents: () => delivery.flush(),
  });
  return {
    coordinator,
    unitOfWork,
    published,
    controls,
    executions,
    finishExecution,
    setTranscript(value: typeof transcript) {
      transcript = value;
    },
  };
}

function start(coordinator: RunCoordinator, scopeId = "conv_a:agent_a") {
  return coordinator.start({
    conversationId: "conv_a",
    agentId: "agent_a",
    projectId: "proj_a",
    prompt: "hello",
    scopeId,
  });
}

test("constructs before committing started and enforces durable exclusivity", async () => {
  const harness = fixture();
  const results = await Promise.allSettled([
    start(harness.coordinator),
    start(harness.coordinator),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.ok(
    results.some(
      (item) =>
        item.status === "rejected" && item.reason instanceof RunConflictError,
    ),
  );
  const state = (await harness.unitOfWork.list())[0]!;
  assert.equal(state.run.status, "running");
  assert.equal(state.transitions[0]?.kind, "started");
  assert.equal(harness.published.size, 1);
});

test("drains ordered steer and follow-up prompts and persists delivery", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  await harness.coordinator.steer(run.runId, "first");
  await harness.coordinator.followUp(run.runId, "second");
  const state = await harness.coordinator.get(run.runId);
  assert.deepEqual(harness.controls, [
    { behavior: "steer", text: "first" },
    { behavior: "follow-up", text: "second" },
  ]);
  assert.deepEqual(
    state?.prompts.map((item) => item.status),
    ["delivered", "delivered"],
  );
});

test("durable event retry is idempotent after publication before marker", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const state = await harness.coordinator.get(run.runId);
  const intent = state?.transitions[0]?.events[0] as RunPublicEventIntent;
  harness.unitOfWork.deliveries.set(run.runId, []);
  const before = harness.published.size;
  const service = new RunEventDeliveryService(
    harness.unitOfWork,
    {
      publish: async (candidate) => {
        const existing = harness.published.get(candidate.id)!;
        return existing;
      },
    },
    () => "2026-07-12T00:00:59.000Z",
  );
  await service.flush();
  assert.equal(harness.published.size, before);
  assert.equal(
    (await harness.coordinator.get(run.runId))?.deliveries.some(
      (item) => item.intentId === intent.id,
    ),
    true,
  );
});

test("projection and publication failure do not lose committed transition", async () => {
  const harness = fixture({ publicationFails: true });
  harness.unitOfWork.materializeFailure = new Error("projection unavailable");
  const run = await start(harness.coordinator);
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "running");
  assert.equal((await harness.unitOfWork.pendingEventIntents()).length, 1);
});

test("resolves an interaction once and rejects conflicting resolution", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const interaction = await harness.coordinator.wait(run.runId, {
    kind: "question",
    toolCallId: "tool_question",
    prompt: "Choose",
    required: true,
    checkpoint: {
      boundary: "suspension",
      transcriptCursor: 0,
      entryIds: [],
      harnessLeafId: null,
      harnessSavePointId: "save_0",
      toolCalls: [],
    },
  });
  const resolved = await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: interaction.id,
    resolutionRequestId: "request_1",
    resolution: { answer: "yes" },
  });
  assert.equal(resolved.status, "resolved");
  await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: interaction.id,
    resolutionRequestId: "request_1",
    resolution: { answer: "yes" },
  });
  await assert.rejects(
    harness.coordinator.resolveInteraction(run.runId, {
      interactionId: interaction.id,
      resolutionRequestId: "request_2",
      resolution: { answer: "no" },
    }),
    RunConflictError,
  );
});

test("continues only from a checkpoint whose complete references match", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const checkpoint = await harness.coordinator.checkpoint(run.runId, {
    boundary: "before_provider_request",
    transcriptCursor: 1,
    entryIds: ["entry_a"],
    harnessLeafId: "entry_a",
    harnessSavePointId: "save_1",
    toolCalls: [],
  });
  harness.setTranscript({
    cursor: 1,
    entryIds: ["entry_a"],
    harnessLeafId: "entry_a",
    harnessSavePointId: "save_1",
  });
  await harness.coordinator.recover();
  const interrupted = await harness.coordinator.get(run.runId);
  assert.equal(interrupted?.run.lastCheckpointId, checkpoint.checkpointId);
  assert.equal(interrupted?.run.status, "interrupted");
  const continued = await harness.coordinator.continue(run.runId);
  assert.equal(continued.status, "retrying");
});

test("partial cancellation is persisted truthfully and is not called cancelled", async () => {
  const harness = fixture({ cancelToolsFails: true });
  const run = await start(harness.coordinator);
  const cancelled = await harness.coordinator.cancel(run.runId);
  assert.equal(cancelled.status, "cancellation_failed");
  assert.equal(
    cancelled.cancellationEvidence.find((item) => item.target === "tool")
      ?.status,
    "failed",
  );
  assert.equal(
    [...harness.published.keys()].some((id) => id.endsWith("/run.cancelled")),
    false,
  );
});

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
