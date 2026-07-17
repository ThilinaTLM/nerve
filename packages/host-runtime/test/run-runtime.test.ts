import assert from "node:assert/strict";
import test from "node:test";
import type {
  RunEventDeliveryRecord,
  RunPublicEventIntent,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  applyRunEventDelivery,
  applyRunTransition,
  createRunRuntime,
  reduceRunTransitions,
  type BufferedRunTransientEventPort,
  type RunExecution,
  type RunExecutionOutcome,
  type RunExecutionSink,
  type RunHydratedState,
  type RunProgressEvent,
  type RunUnitOfWorkPort,
} from "../src/index.js";
import { checksum } from "./test-checksum.js";

class MemoryUnitOfWork implements RunUnitOfWorkPort {
  transitions = new Map<string, RunTransitionRecord[]>();
  deliveries = new Map<string, RunEventDeliveryRecord[]>();

  async load(runId: string): Promise<RunHydratedState | undefined> {
    return reduceRunTransitions(
      this.transitions.get(runId) ?? [],
      this.deliveries.get(runId) ?? [],
    );
  }
  async findActive(scopeId: string) {
    return (await this.listActive()).find(
      (item) => item.run.scopeId === scopeId,
    );
  }
  async listActive() {
    return (await this.list()).filter(
      (item) => !["completed", "failed", "cancelled"].includes(item.run.status),
    );
  }
  async findByInteractionId(interactionId: string) {
    return (await this.listActive()).find((item) =>
      item.interactions.some((interaction) => interaction.id === interactionId),
    );
  }
  async findByInteractionToolCallId(toolCallId: string) {
    return (await this.listActive()).find((item) =>
      item.interactions.some(
        (interaction) => interaction.toolCallId === toolCallId,
      ),
    );
  }
  async findByPromptId(promptId: string) {
    return (await this.listActive()).find((item) =>
      item.prompts.some((prompt) => prompt.id === promptId),
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
    const committed = structuredClone(transition);
    const next = applyRunTransition(current, committed);
    this.transitions.set(transition.runId, [
      ...(this.transitions.get(transition.runId) ?? []),
      committed,
    ]);
    return next;
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
    const state = await this.load(delivery.runId);
    if (!state) throw new Error(`Unknown run: ${delivery.runId}`);
    const next = applyRunEventDelivery(state, delivery);
    this.deliveries.set(delivery.runId, [...next.deliveries]);
  }
  async materialize(): Promise<void> {}
}

function fixture(
  options: {
    publicationFails?: boolean;
    execute?: (
      attempt: number,
      sink: RunExecutionSink,
    ) => Promise<RunExecutionOutcome>;
    retryPolicy?: { enabled: boolean; maxRetries: number; baseDelayMs: number };
  } = {},
) {
  const unitOfWork = new MemoryUnitOfWork();
  const ordering: string[] = [];
  const published = new Map<string, { eventId: string; sequence: number }>();
  const observed: RunTransitionRecord[] = [];
  const transientEvents: RunProgressEvent[] = [];
  let attempts = 0;
  let id = 0;
  let finishExecution!: (value: RunExecutionOutcome) => void;
  const executeResult = new Promise<RunExecutionOutcome>((resolve) => {
    finishExecution = resolve;
  });

  const transient: BufferedRunTransientEventPort = {
    publish: (event) => {
      transientEvents.push(event);
    },
    flush: async () => {
      ordering.push("transient-flush");
    },
  };

  const runtime = createRunRuntime({
    sourceRole: "sandbox_agent",
    unitOfWork,
    publisher: {
      publish: async (intent: RunPublicEventIntent) => {
        if (options.publicationFails) throw new Error("journal unavailable");
        ordering.push(`durable:${intent.type}`);
        const existing = published.get(intent.id);
        if (existing) return existing;
        const value = { eventId: intent.id, sequence: published.size + 1 };
        published.set(intent.id, value);
        return value;
      },
    },
    transient,
    execution: {
      create: async (_run, sink) => {
        attempts += 1;
        const attempt = attempts;
        const execution: RunExecution = {
          control: {
            steer: async () => {},
            followUp: async () => {},
            removeQueuedPrompt: async () => true,
            continue: async () => {},
            cancel: async () => {},
          },
          execute: async () =>
            options.execute ? options.execute(attempt, sink) : executeResult,
        };
        return execution;
      },
    },
    references: {
      stateEpoch: () => 1,
      transcript: async () => ({
        cursor: 0,
        entryIds: [],
        harnessLeafId: null,
        harnessSavePointId: "save_0",
      }),
      toolCalls: async () => [],
      interaction: async () => undefined,
    },
    cancellation: {
      cancelModel: async () => "confirmed",
      cancelTools: async () => "confirmed",
      cancelTasks: async () => "not_running",
      cancelSubagents: async () => "not_running",
      cancelInteraction: async () => "not_running",
    },
    clock: { now: () => new Date("2026-07-12T00:00:59.000Z") },
    ids: { next: () => String(++id) },
    integrity: { checksum },
    retryPolicy: options.retryPolicy,
    retryDelay: async (_delayMs, signal) => {
      if (signal.aborted) throw new Error("aborted");
    },
    transitionObserver: {
      committed: async (transition) => {
        observed.push(transition);
      },
    },
  });

  return {
    ...runtime,
    unitOfWork,
    ordering,
    published,
    observed,
    transientEvents,
    finishExecution,
  };
}

function start(harness: ReturnType<typeof fixture>) {
  return harness.coordinator.start({
    conversationId: "conv_a",
    agentId: "agent_a",
    projectId: "proj_a",
    prompt: "hello",
    scopeId: "conv_a:agent_a",
  });
}

test("delivers durable intents before flushing the transient tail", async () => {
  const harness = fixture();
  await start(harness);
  const flushIndex = harness.ordering.indexOf("transient-flush");
  const durableIndex = harness.ordering.indexOf("durable:run.started");
  assert.ok(durableIndex >= 0, "run.started must be delivered durably");
  assert.ok(flushIndex >= 0, "transient tail must be flushed");
  assert.ok(
    durableIndex < flushIndex,
    "durable intents must land before the transient flush",
  );
});

test("returns one delivery service wired to the same unit of work", async () => {
  const harness = fixture({ publicationFails: true });
  const run = await start(harness);
  // Publication failed, so the run stays committed with pending intents.
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "running");
  assert.equal((await harness.unitOfWork.pendingEventIntents()).length, 1);
});

test("recovers pending intents through the returned delivery service", async () => {
  const harness = fixture({ publicationFails: true });
  await start(harness);
  assert.equal((await harness.unitOfWork.pendingEventIntents()).length, 1);
  // Delivery failures are sticky until the same delivery instance recovers.
  await assert.rejects(harness.delivery.flush());
});

test("uses the injected clock for delivery timestamps", async () => {
  const harness = fixture();
  const run = await start(harness);
  const deliveries = harness.unitOfWork.deliveries.get(run.runId) ?? [];
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.deliveredAt, "2026-07-12T00:00:59.000Z");
});

test("propagates the transition observer and retry policy", async () => {
  const harness = fixture({
    execute: async (attempt, sink) => {
      if (attempt === 1) {
        await sink.checkpoint({
          boundary: "before_provider_request",
          transcriptCursor: 0,
          entryIds: [],
          harnessLeafId: null,
          harnessSavePointId: "save_0",
          toolCalls: [],
        });
        return {
          status: "failed" as const,
          failure: {
            code: "PROVIDER_FAILED",
            message: "temporary",
            retryable: true,
          },
        };
      }
      return { status: "completed" as const };
    },
    retryPolicy: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
  });
  const run = await start(harness);
  const finished = await waitForTerminal(harness, run.runId);
  assert.equal(finished?.run.status, "completed");
  assert.ok(
    harness.ordering.includes("durable:run.retrying"),
    "retry policy must drive a run.retrying intent",
  );
  assert.ok(
    harness.observed.length > 0,
    "observer must see committed transitions",
  );
});

async function waitForTerminal(
  harness: ReturnType<typeof fixture>,
  runId: string,
): Promise<RunHydratedState | undefined> {
  const startedAt = Date.now();
  for (;;) {
    const state = await harness.coordinator.get(runId);
    if (
      state &&
      ["completed", "failed", "cancelled"].includes(state.run.status)
    ) {
      return state;
    }
    if (Date.now() - startedAt > 3_000) return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
