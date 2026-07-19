/* eslint-disable max-lines -- Coordinator contract scenarios share one deterministic in-memory fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RUN_FAILURE_MESSAGE_MAX_LENGTH,
  type PeerRole,
  type RunEventDeliveryRecord,
  type RunPublicEventIntent,
  type RunTransitionRecord,
} from "@nervekit/contracts";
import {
  RunConflictError,
  RunCoordinator,
  RunEventDeliveryService,
  applyRunEventDelivery,
  applyRunTransition,
  reduceRunTransitions,
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
  materializeFailure?: Error;

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
  async materialize(state: RunHydratedState) {
    void state;
    if (this.materializeFailure) throw this.materializeFailure;
  }
}

function fixture(
  options: {
    cancelToolsFails?: boolean;
    cancelTarget?: (
      target: "model" | "tool" | "task" | "subagent" | "interaction",
    ) => Promise<"confirmed" | "not_running">;
    publicationFails?: boolean;
    sourceRole?: PeerRole;
    execute?: (
      attempt: number,
      input: Parameters<RunExecution["execute"]>[0],
      sink: RunExecutionSink,
    ) => Promise<RunExecutionOutcome>;
    retryPolicy?: { enabled: boolean; maxRetries: number; baseDelayMs: number };
    observerFails?: boolean;
    beforeFlushEvents?: (transition: RunTransitionRecord) => Promise<void>;
    retryDelay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
    removeQueuedPrompt?: (promptId: string) => boolean | Promise<boolean>;
  } = {},
) {
  const unitOfWork = new MemoryUnitOfWork();
  const published = new Map<string, { eventId: string; sequence: number }>();
  const publicationAttempts: RunPublicEventIntent[] = [];
  const controls: Array<{ behavior: string; text: string }> = [];
  const controlPrompts: import("@nervekit/contracts").RunPromptRecord[] = [];
  const controlContinues: number[] = [];
  const controlCancels: Array<string | undefined> = [];
  const removedPromptIds: string[] = [];
  const executions: RunExecution[] = [];
  const sinks: RunExecutionSink[] = [];
  const notifyEvents: RunProgressEvent[] = [];
  const executionInputs: Parameters<RunExecution["execute"]>[0][] = [];
  const observed: RunTransitionRecord[] = [];
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
        publicationAttempts.push(intent);
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
    sourceRole: options.sourceRole ?? "sandbox_agent",
    notify: { publish: (event) => notifyEvents.push(event) },
    execution: {
      create: async (_run, sink) => {
        sinks.push(sink);
        const attempt = executions.length + 1;
        const execution: RunExecution = {
          control: {
            steer: async (prompt) => {
              controls.push({ behavior: prompt.behavior, text: prompt.text });
              controlPrompts.push(prompt);
            },
            followUp: async (prompt) => {
              controls.push({ behavior: prompt.behavior, text: prompt.text });
              controlPrompts.push(prompt);
            },
            removeQueuedPrompt: async (promptId) => {
              removedPromptIds.push(promptId);
              return options.removeQueuedPrompt
                ? options.removeQueuedPrompt(promptId)
                : true;
            },
            continue: async () => {
              controlContinues.push(attempt);
            },
            cancel: async (reason) => {
              controlCancels.push(reason);
            },
          },
          execute: async (input) => {
            executionInputs.push(input);
            return options.execute
              ? options.execute(attempt, input, sink)
              : executeResult;
          },
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
      cancelModel: async () => options.cancelTarget?.("model") ?? "confirmed",
      cancelTools: async () => {
        if (options.cancelToolsFails) throw new Error("tool still running");
        return options.cancelTarget?.("tool") ?? "confirmed";
      },
      cancelTasks: async () => options.cancelTarget?.("task") ?? "not_running",
      cancelSubagents: async () =>
        options.cancelTarget?.("subagent") ?? "not_running",
      cancelInteraction: async () =>
        options.cancelTarget?.("interaction") ?? "not_running",
    },
    clock: {
      now: () =>
        new Date(`2026-07-12T00:00:${String(id).padStart(2, "0")}.000Z`),
    },
    ids: { next: () => String(++id) },
    integrity: { checksum },
    retryPolicy: options.retryPolicy,
    retryDelay:
      options.retryDelay ??
      (async (_delayMs, signal) => {
        if (signal.aborted) throw new Error("aborted");
      }),
    transitionObserver: {
      committed: async (transition) => {
        observed.push(transition);
        if (options.observerFails) throw new Error("observer unavailable");
      },
    },
    flushEvents: async (transition) => {
      await options.beforeFlushEvents?.(transition);
      await delivery.flushTransition(transition);
    },
  });
  return {
    coordinator,
    unitOfWork,
    published,
    publicationAttempts,
    controls,
    controlPrompts,
    controlContinues,
    controlCancels,
    removedPromptIds,
    executions,
    sinks,
    notifyEvents,
    executionInputs,
    observed,
    finishExecution,
    flushEvents: () => delivery.flush(),
    setTranscript(value: typeof transcript) {
      transcript = value;
    },
  };
}

function suspensionCheckpoint() {
  return {
    boundary: "suspension" as const,
    transcriptCursor: 0,
    entryIds: [],
    harnessLeafId: null,
    harnessSavePointId: "save_0",
    toolCalls: [],
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

test("keeps accepted prompts queued until the execution reports delivery", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  await harness.coordinator.steer(run.runId, "first");
  await harness.coordinator.followUp(run.runId, "second");
  let state = await harness.coordinator.get(run.runId);
  assert.deepEqual(harness.controls, [
    { behavior: "steer", text: "first" },
    { behavior: "follow-up", text: "second" },
  ]);
  assert.deepEqual(
    state?.prompts.map((item) => item.status),
    ["accepted", "accepted"],
  );
  assert.equal(
    state?.transitions
      .flatMap((transition) => transition.events)
      .some((event) => event.type === "conversation.prompt.dequeued"),
    false,
  );

  for (const prompt of state?.prompts ?? []) {
    await harness.sinks[0]?.promptDelivered(prompt.id);
  }
  state = await harness.coordinator.get(run.runId);
  assert.deepEqual(
    state?.prompts.map((item) => item.status),
    ["delivered", "delivered"],
  );
  assert.equal(
    state?.transitions
      .flatMap((transition) => transition.events)
      .filter((event) => event.type === "conversation.prompt.dequeued").length,
    2,
  );

  await harness.sinks[0]?.promptDelivered(state?.prompts[0]?.id ?? "");
  const replayed = await harness.coordinator.get(run.runId);
  assert.equal(
    replayed?.transitions
      .flatMap((transition) => transition.events)
      .filter((event) => event.type === "conversation.prompt.dequeued").length,
    2,
  );
});

test("re-enqueues accepted prompts when a new execution is launched", async () => {
  let releaseFirstAttempt!: () => void;
  const firstAttemptGate = new Promise<void>((resolve) => {
    releaseFirstAttempt = resolve;
  });
  let promptId = "";
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
    execute: async (attempt, _input, sink) => {
      if (attempt === 1) {
        await firstAttemptGate;
        await sink.checkpoint({
          boundary: "before_provider_request",
          transcriptCursor: 0,
          entryIds: [],
          harnessLeafId: null,
          harnessSavePointId: "save_0",
          toolCalls: [],
        });
        return {
          status: "failed",
          failure: {
            code: "PROVIDER_FAILED",
            message: "restart execution",
            retryable: true,
          },
        };
      }
      await sink.promptDelivered(promptId);
      return { status: "completed" };
    },
  });
  const run = await start(harness.coordinator);
  const prompt = await harness.coordinator.followUp(run.runId, "survive retry");
  promptId = prompt.id;
  releaseFirstAttempt();

  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "completed",
  );
  const state = await harness.coordinator.get(run.runId);
  assert.equal(
    harness.controls.filter((control) => control.text === "survive retry")
      .length,
    2,
  );
  assert.equal(
    state?.prompts.find((candidate) => candidate.id === prompt.id)?.status,
    "delivered",
  );
});

test("preserves images on start, steer, and follow-up delivery", async () => {
  const harness = fixture();
  const image = {
    type: "image" as const,
    data: "aGVsbG8=",
    mimeType: "image/png",
  };
  const run = await harness.coordinator.start({
    conversationId: "conv_a",
    agentId: "agent_a",
    projectId: "proj_a",
    prompt: "hello",
    images: [image],
  });
  await harness.coordinator.steer(run.runId, "first", [image]);
  await harness.coordinator.followUp(run.runId, "second", [image]);
  assert.deepEqual(harness.executionInputs[0]?.images, [image]);
  assert.deepEqual(
    harness.controlPrompts.map((prompt) => prompt.images),
    [[image], [image]],
  );
  assert.deepEqual(
    (await harness.coordinator.get(run.runId))?.prompts.map(
      (prompt) => prompt.images,
    ),
    [[image], [image]],
  );
});

test("commits prompt dequeue and cancellation intents exactly once", async () => {
  const deliveredHarness = fixture();
  const deliveredRun = await start(deliveredHarness.coordinator);
  const deliveredPrompt = await deliveredHarness.coordinator.steer(
    deliveredRun.runId,
    "delivered",
  );
  await deliveredHarness.sinks[0]?.promptDelivered(deliveredPrompt.id);
  const deliveredState = await deliveredHarness.coordinator.get(
    deliveredRun.runId,
  );
  const deliveredTypes = deliveredState?.transitions.flatMap((transition) =>
    transition.events.map((event) => event.type),
  );
  assert.equal(
    deliveredTypes?.filter((type) => type === "conversation.prompt.dequeued")
      .length,
    1,
  );

  const cancelledHarness = fixture({
    execute: async () => ({ status: "suspended" }),
  });
  const cancelledRun = await start(cancelledHarness.coordinator);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const queued = await cancelledHarness.coordinator.followUp(
    cancelledRun.runId,
    "cancel me",
  );
  await cancelledHarness.coordinator.cancelPrompt(
    cancelledRun.runId,
    queued.id,
  );
  const cancelledState = await cancelledHarness.coordinator.get(
    cancelledRun.runId,
  );
  const cancelledTypes = cancelledState?.transitions.flatMap((transition) =>
    transition.events.map((event) => event.type),
  );
  assert.equal(
    cancelledTypes?.filter((type) => type === "conversation.prompt.cancelled")
      .length,
    1,
  );
});

test("removes an accepted live prompt before committing cancellation", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const prompt = await harness.coordinator.followUp(run.runId, "cancel me");

  await harness.coordinator.cancelPrompt(run.runId, prompt.id);
  await harness.sinks[0]?.promptDelivered(prompt.id);

  const state = await harness.coordinator.get(run.runId);
  assert.deepEqual(harness.removedPromptIds, [prompt.id]);
  assert.equal(
    state?.prompts.find((candidate) => candidate.id === prompt.id)?.status,
    "cancelled",
  );
  const promptEvents = state?.transitions
    .flatMap((transition) => transition.events)
    .filter((event) => event.type.startsWith("conversation.prompt."));
  assert.deepEqual(
    promptEvents?.map((event) => event.type),
    ["conversation.prompt.queued", "conversation.prompt.cancelled"],
  );
});

test("does not claim cancellation after an accepted prompt was drained", async () => {
  const harness = fixture({ removeQueuedPrompt: () => false });
  const run = await start(harness.coordinator);
  const prompt = await harness.coordinator.followUp(run.runId, "too late");

  await assert.rejects(
    harness.coordinator.cancelPrompt(run.runId, prompt.id),
    /Queued prompt was not found/,
  );
  await harness.sinks[0]?.promptDelivered(prompt.id);

  const state = await harness.coordinator.get(run.runId);
  assert.equal(
    state?.prompts.find((candidate) => candidate.id === prompt.id)?.status,
    "delivered",
  );
});

test("automatically retries a valid checkpoint with accurate metadata", async () => {
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 2, baseDelayMs: 25 },
    execute: async (attempt, _input, sink) => {
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
          status: "failed",
          failure: {
            code: "PROVIDER_FAILED",
            message: "temporary",
            retryable: true,
          },
        };
      }
      return { status: "completed" };
    },
  });
  const run = await start(harness.coordinator);
  await waitUntil(async () =>
    ["completed", "failed", "interrupted"].includes(
      (await harness.coordinator.get(run.runId))?.run.status ?? "",
    ),
  );
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "completed");
  assert.equal(state?.run.attempt, 2);
  assert.notEqual(
    harness.executionInputs[0]?.run.executionId,
    harness.executionInputs[1]?.run.executionId,
  );
  const retry = state?.transitions
    .flatMap((transition) => transition.events)
    .find((event) => event.type === "run.retrying");
  assert.equal((retry?.data as { attempt?: number })?.attempt, 1);
  assert.equal((retry?.data as { maxRetries?: number })?.maxRetries, 2);
  assert.equal((retry?.data as { delayMs?: number })?.delayMs, 25);
});

test("bounds execution failure messages before persisting a retry", async () => {
  const oversizedMessage = `provider returned error 503: ${"x".repeat(
    RUN_FAILURE_MESSAGE_MAX_LENGTH,
  )}`;
  const expectedMessage = oversizedMessage.slice(
    0,
    RUN_FAILURE_MESSAGE_MAX_LENGTH,
  );
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    execute: async (attempt, _input, sink) => {
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
          status: "failed",
          failure: {
            code: "MODEL_REQUEST_FAILED",
            message: oversizedMessage,
            retryable: true,
          },
        };
      }
      return { status: "completed" };
    },
  });

  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "completed",
  );

  const state = await harness.coordinator.get(run.runId);
  const retry = state?.transitions.find(
    (transition) => transition.kind === "retrying",
  );
  assert.equal(state?.run.attempt, 2);
  assert.equal(
    state?.transitions.filter((transition) => transition.kind === "retrying")
      .length,
    1,
  );
  assert.deepEqual(retry?.run.failure, {
    code: "MODEL_REQUEST_FAILED",
    message: expectedMessage,
    retryable: true,
  });
  assert.deepEqual(retry?.execution?.failure, retry?.run.failure);
  const retryEvent = retry?.events.find(
    (event) => event.type === "run.retrying",
  );
  assert.equal(
    (retryEvent?.data as { errorMessage?: string })?.errorMessage,
    expectedMessage,
  );
});

test("HITL resumes do not consume the automatic retry budget", async () => {
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    execute: async (attempt, _input, sink) => {
      if (attempt === 1) {
        await sink.wait({
          kind: "question",
          toolCallId: "tool_retry_budget_question",
          prompt: "Continue?",
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
        return { status: "suspended" };
      }
      if (attempt === 2) {
        await sink.checkpoint({
          boundary: "before_provider_request",
          transcriptCursor: 0,
          entryIds: [],
          harnessLeafId: null,
          harnessSavePointId: "save_0",
          toolCalls: [],
        });
        return {
          status: "failed",
          failure: {
            code: "PROVIDER_FAILED",
            message: "temporary after HITL",
            retryable: true,
          },
        };
      }
      return { status: "completed" };
    },
  });
  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "waiting",
  );
  const waiting = await harness.coordinator.get(run.runId);
  const interaction = waiting?.interactions.find(
    (candidate) => candidate.status === "pending",
  );
  assert.ok(interaction);
  await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: interaction.id,
    resolutionRequestId: "request_retry_budget",
    resolution: { answer: "yes" },
  });
  await harness.coordinator.continue(run.runId);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "completed",
  );
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.attempt, 3);
  assert.equal(
    state?.transitions.filter((transition) => transition.kind === "resumed")
      .length,
    1,
  );
  assert.equal(
    state?.transitions.filter((transition) => transition.kind === "retrying")
      .length,
    1,
  );
  const retry = state?.transitions
    .flatMap((transition) => transition.events)
    .find((event) => event.type === "run.retrying");
  assert.equal((retry?.data as { attempt?: number })?.attempt, 1);
});

test("refuses automatic retry without a valid checkpoint", async () => {
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    execute: async () => ({
      status: "failed",
      failure: {
        code: "PROVIDER_FAILED",
        message: "no checkpoint",
        retryable: true,
      },
    }),
  });
  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "failed",
  );
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.failure?.code, "PROVIDER_FAILED");
  assert.equal(
    state?.transitions.some((transition) => transition.kind === "retrying"),
    false,
  );
  assert.equal(harness.executions.length, 1);
});

test("allows manual continuation without automatically retrying", async () => {
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    execute: async (attempt, _input, sink) => {
      if (attempt > 1) return { status: "completed" };
      await sink.checkpoint({
        boundary: "before_provider_request",
        transcriptCursor: 0,
        entryIds: [],
        harnessLeafId: null,
        harnessSavePointId: "save_0",
        toolCalls: [],
      });
      return {
        status: "failed",
        failure: {
          code: "MODEL_REQUEST_FAILED",
          message: "billing must be updated",
          retryable: false,
          continuable: true,
        },
      };
    },
  });
  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "interrupted",
  );

  let state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.recoverability, "checkpoint");
  assert.equal(
    state?.transitions.some((transition) => transition.kind === "retrying"),
    false,
  );
  assert.equal(harness.executions.length, 1);
  const failureEvent = state?.transitions
    .at(-1)
    ?.events.find((event) => event.type === "run.failed");
  assert.equal(
    (failureEvent?.data as { interrupted?: boolean })?.interrupted,
    true,
  );
  assert.equal(
    (failureEvent?.data as { continuable?: boolean })?.continuable,
    true,
  );

  const continued = await harness.coordinator.continue(run.runId);
  assert.equal(continued.status, "running");
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "completed",
  );
  state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.attempt, 2);
  assert.equal(harness.executions.length, 2);
});

test("keeps a continuable failure terminal without a valid checkpoint", async () => {
  const harness = fixture({
    execute: async () => ({
      status: "failed",
      failure: {
        code: "MODEL_REQUEST_FAILED",
        message: "billing must be updated",
        retryable: false,
        continuable: true,
      },
    }),
  });
  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "failed",
  );

  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.recoverability, "none");
  await assert.rejects(() => harness.coordinator.continue(run.runId));
});

test("cancels a scheduled retry without launching a new execution", async () => {
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 2, baseDelayMs: 25 },
    retryDelay: async (_delayMs, signal) =>
      new Promise<void>((_resolve, reject) => {
        const rejectAbort = () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        };
        if (signal.aborted) rejectAbort();
        else signal.addEventListener("abort", rejectAbort, { once: true });
      }),
    execute: async (_attempt, _input, sink) => {
      await sink.checkpoint({
        boundary: "before_provider_request",
        transcriptCursor: 0,
        entryIds: [],
        harnessLeafId: null,
        harnessSavePointId: "save_0",
        toolCalls: [],
      });
      return {
        status: "failed",
        failure: {
          code: "PROVIDER_FAILED",
          message: "temporary",
          retryable: true,
        },
      };
    },
  });
  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "retrying",
  );
  const cancelled = await harness.coordinator.cancel(run.runId);
  assert.equal(cancelled.status, "cancelled");
  const cancellationEvents = harness.publicationAttempts.filter(
    (event) => event.type === "run.cancelled",
  );
  assert.equal(cancellationEvents.length, 1);
  assert.deepEqual(cancellationEvents[0]?.data, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    cancelledAt: cancelled.updatedAt,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.executions.length, 1);
});

test("retry exhaustion leaves a valid checkpoint recoverable", async () => {
  const harness = fixture({
    retryPolicy: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    execute: async (_attempt, _input, sink) => {
      await sink.checkpoint({
        boundary: "before_provider_request",
        transcriptCursor: 0,
        entryIds: [],
        harnessLeafId: null,
        harnessSavePointId: "save_0",
        toolCalls: [],
      });
      return {
        status: "failed",
        failure: {
          code: "PROVIDER_FAILED",
          message: "still down",
          retryable: true,
        },
      };
    },
  });
  const run = await start(harness.coordinator);
  await waitUntil(
    async () =>
      (await harness.coordinator.get(run.runId))?.run.status === "interrupted",
  );
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.recoverability, "checkpoint");
  assert.equal(state?.run.attempt, 2);
  assert.equal(
    state?.transitions.filter((transition) => transition.kind === "retrying")
      .length,
    1,
  );
});

test("transition observer failures are isolated after durable ordering", async () => {
  const harness = fixture({ observerFails: true });
  const run = await start(harness.coordinator);
  assert.equal(
    (await harness.coordinator.get(run.runId))?.run.status,
    "running",
  );
  assert.equal(harness.observed[0]?.kind, "started");
  assert.equal(harness.published.size, 1);
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

test("settled reads hide terminal state until its complete commit pipeline settles", async () => {
  let releaseTerminal!: () => void;
  const terminalGate = new Promise<void>((resolve) => {
    releaseTerminal = resolve;
  });
  let markTerminalFlushStarted!: () => void;
  const terminalFlushStarted = new Promise<void>((resolve) => {
    markTerminalFlushStarted = resolve;
  });
  const harness = fixture({
    execute: async (_attempt, input, sink) => {
      await sink.appendEntries([
        {
          id: "entry_settled_user",
          conversationId: input.run.conversationId,
          agentId: input.run.agentId,
          runId: input.run.runId,
          role: "user",
          kind: "message",
          text: "committed before completion",
          createdAt: "2026-07-12T00:00:30.000Z",
        },
      ]);
      return { status: "completed" };
    },
    beforeFlushEvents: async (transition) => {
      if (transition.kind !== "completed") return;
      markTerminalFlushStarted();
      await terminalGate;
    },
  });
  const run = await start(harness.coordinator);
  await terminalFlushStarted;
  assert.equal(
    (await harness.unitOfWork.load(run.runId))?.run.status,
    "completed",
    "the old interleaving exposed this authoritative terminal commit",
  );

  let readFinished = false;
  const read = harness.coordinator
    .readSettled(() => harness.unitOfWork.list())
    .then((states) => {
      readFinished = true;
      return states;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readFinished, false);

  releaseTerminal();
  const states = await read;
  assert.equal(states[0]?.run.status, "completed");
  assert.equal(
    states[0]?.transitions.flatMap((item) => item.entries).length,
    1,
  );
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
  const resumed = await harness.coordinator.continue(run.runId);
  assert.equal(resumed.status, "running");
  const state = await harness.coordinator.get(run.runId);
  assert.equal(state?.transitions.at(-1)?.kind, "resumed");
  assert.deepEqual(
    state?.transitions.at(-1)?.events.map((event) => event.type),
    ["run.resumed"],
  );
});

test("keeps an interaction batch waiting until every member resolves", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const batchToolCallIds = ["tool_first", "tool_second"];
  const checkpoint = suspensionCheckpoint();
  const interactions = await harness.coordinator.waitMany(run.runId, [
    {
      kind: "approval",
      interactionId: "approval_first",
      toolCallId: "tool_first",
      batchToolCallIds,
      prompt: "Approve first",
      risk: ["write"],
      normalizedArgs: { order: 1 },
      offeredScopes: ["single_call"],
      checkpoint,
    },
    {
      kind: "approval",
      interactionId: "approval_second",
      toolCallId: "tool_second",
      batchToolCallIds,
      prompt: "Approve second",
      risk: ["write"],
      normalizedArgs: { order: 2 },
      offeredScopes: ["single_call"],
      checkpoint,
    },
  ]);

  let state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "waiting");
  assert.equal(state?.run.activeInteractionId, "approval_first");
  assert.equal(new Set(interactions.map((item) => item.checkpointId)).size, 1);
  assert.deepEqual(
    interactions.map((item) => item.batchToolCallIds),
    [batchToolCallIds, batchToolCallIds],
  );
  assert.equal(
    state?.transitions
      .at(-1)
      ?.events.filter((event) => event.type === "run.waiting").length,
    2,
  );
  const second = await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: "approval_second",
    resolutionRequestId: "partial",
    resolution: { decision: "allow" },
  });
  assert.equal(second.status, "resolved");
  state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "waiting");
  assert.equal(state?.run.activeInteractionId, "approval_first");
  assert.deepEqual(harness.controlContinues, []);
  await assert.rejects(
    harness.coordinator.continue(run.runId),
    /All interactions must be resolved/,
  );

  await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: "approval_first",
    resolutionRequestId: "final",
    resolution: { decision: "deny" },
  });
  state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "suspended");
  assert.equal(state?.run.activeInteractionId, undefined);
  assert.deepEqual(harness.controlContinues, [1]);

  await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: "approval_first",
    resolutionRequestId: "final",
    resolution: { decision: "deny" },
  });
  assert.deepEqual(harness.controlContinues, [1]);
  await assert.rejects(
    harness.coordinator.resolveInteraction(run.runId, {
      interactionId: "approval_second",
      resolutionRequestId: "conflict",
      resolution: { decision: "deny" },
    }),
    RunConflictError,
  );
});

test("cancellation terminalizes every pending approval batch member", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const batchToolCallIds = ["tool_first", "tool_second"];
  await harness.coordinator.waitMany(run.runId, [
    {
      kind: "approval",
      toolCallId: "tool_first",
      batchToolCallIds,
      prompt: "Approve first",
      risk: ["write"],
      normalizedArgs: {},
      offeredScopes: ["single_call"],
      checkpoint: suspensionCheckpoint(),
    },
    {
      kind: "approval",
      toolCallId: "tool_second",
      batchToolCallIds,
      prompt: "Approve second",
      risk: ["write"],
      normalizedArgs: {},
      offeredScopes: ["single_call"],
      checkpoint: suspensionCheckpoint(),
    },
  ]);

  await harness.coordinator.cancel(run.runId);
  const state = await harness.coordinator.get(run.runId);
  assert.deepEqual(
    state?.interactions.map((interaction) => interaction.status),
    ["cancelled", "cancelled"],
  );
});

test("publishes a bounded plan preview while retaining the full interaction", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const content = "long plan line\n".repeat(2_000);
  const interaction = await harness.coordinator.wait(run.runId, {
    kind: "plan_review",
    toolCallId: "tool_plan_long",
    prompt: "Review long plan",
    planReview: {
      id: "plan_review_long",
      toolCallId: "tool_plan_long",
      agentId: "agent_a",
      conversationId: "conv_a",
      projectId: "proj_a",
      slug: "long-plan",
      planPath: "/tmp/long-plan.md",
      content,
      status: "pending",
      requestedAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    checkpoint: suspensionCheckpoint(),
  });

  assert.equal(interaction.planReview.content, content);
  assert.equal(
    (await harness.coordinator.get(run.runId))?.run.status,
    "waiting",
  );
  const waiting = harness.publicationAttempts.find(
    (intent) => intent.type === "run.waiting",
  );
  assert.ok(waiting);
  const publicReview = waiting.data.planReview as { content?: string };
  assert.ok((publicReview.content?.length ?? 0) < content.length);
  assert.equal(publicReview.content?.split("\n").length, 10);
});

test("atomically resolves and completes an interaction without waking execution", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const interaction = await harness.coordinator.wait(run.runId, {
    kind: "plan_review",
    toolCallId: "tool_plan",
    prompt: "Review plan",
    planReview: {
      id: "plan_review_a",
      toolCallId: "tool_plan",
      agentId: "agent_a",
      conversationId: "conv_a",
      projectId: "proj_a",
      slug: "plan",
      planPath: "/tmp/plan.md",
      status: "pending",
      requestedAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    checkpoint: suspensionCheckpoint(),
  });
  const command = {
    interactionId: interaction.id,
    resolutionRequestId: "request_terminal",
    resolution: { decision: "reject" },
  };

  const completed = await harness.coordinator.resolveAndCompleteInteraction(
    run.runId,
    command,
  );
  assert.equal(completed.status, "completed");
  assert.deepEqual(harness.controlContinues, []);
  assert.deepEqual(harness.controlCancels, ["interaction terminally resolved"]);
  let state = await harness.coordinator.get(run.runId);
  assert.equal(state?.interactions[0]?.status, "resolved");
  assert.equal(
    state?.transitions.at(-1)?.kind,
    "interaction_resolved_completed",
  );

  const duplicate = await harness.coordinator.resolveAndCompleteInteraction(
    run.runId,
    command,
  );
  assert.equal(duplicate.status, "completed");
  await assert.rejects(
    harness.coordinator.resolveAndCompleteInteraction(run.runId, {
      ...command,
      resolutionRequestId: "request_conflict",
      resolution: { decision: "accept" },
    }),
    RunConflictError,
  );

  harness.finishExecution({ status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  state = await harness.coordinator.get(run.runId);
  assert.equal(state?.run.status, "completed");
  assert.equal(
    state?.transitions.at(-1)?.kind,
    "interaction_resolved_completed",
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
  assert.equal(
    (
      interrupted?.transitions.at(-1)?.events[0]?.data as
        | { continuable?: boolean }
        | undefined
    )?.continuable,
    true,
  );
  const continued = await harness.coordinator.continue(run.runId);
  assert.equal(continued.status, "running");
  const continuedState = await harness.coordinator.get(run.runId);
  assert.equal(continuedState?.transitions.at(-1)?.kind, "resumed");
  assert.equal(
    continuedState?.transitions.at(-1)?.events[0]?.type,
    "run.resumed",
  );
  assert.equal(
    (
      continuedState?.transitions.at(-1)?.events[0]?.data as
        | { resumeKind?: string }
        | undefined
    )?.resumeKind,
    "manual",
  );
});

test("starts every cancellation target before awaiting target cleanup", async () => {
  let releaseModel!: () => void;
  const modelBlocked = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  const started: string[] = [];
  const harness = fixture({
    cancelTarget: async (target) => {
      started.push(target);
      if (target === "model") await modelBlocked;
      return target === "model" || target === "tool"
        ? "confirmed"
        : "not_running";
    },
  });
  const run = await start(harness.coordinator);
  const cancellation = harness.coordinator.cancel(run.runId);

  await waitUntil(() => Promise.resolve(started.length === 5));
  assert.deepEqual(
    new Set(started),
    new Set(["model", "tool", "task", "subagent", "interaction"]),
  );
  releaseModel();

  const cancelled = await cancellation;
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(
    cancelled.cancellationEvidence.map((item) => item.target),
    ["model", "tool", "task", "subagent", "interaction"],
  );
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

test("execution sink journals and publishes durable entry events once", async () => {
  for (const sourceRole of [
    "sandbox_agent",
    "workbench_server",
  ] satisfies PeerRole[]) {
    const harness = fixture({ sourceRole });
    const run = await start(harness.coordinator);
    const entry = {
      id: `entry_${sourceRole}`,
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      turnId: `turn_${sourceRole}`,
      liveMessageId: `msg_${sourceRole}`,
      messageOrdinal: 2,
      role: "assistant" as const,
      kind: "message" as const,
      text: "I should inspect the project.",
      createdAt: "2026-07-12T00:00:10.000Z",
    };

    await harness.sinks[0]!.appendEntries([entry]);

    const state = await harness.coordinator.get(run.runId);
    const appended = state?.transitions.find(
      (item) => item.kind === "entries_appended",
    );
    const entryEvents =
      appended?.events.filter(
        (event) => event.type === "conversation.entry.appended",
      ) ?? [];
    assert.equal(appended?.entries[0]?.id, entry.id);
    assert.equal(appended?.run.revision, state?.run.revision);
    assert.equal(entryEvents.length, 1);
    assert.equal(entryEvents[0]?.occurredAt, entry.createdAt);
    assert.match(entryEvents[0]?.id ?? "", new RegExp(`_${entry.id}$`));
    assert.deepEqual(entryEvents[0]?.data, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      turnId: entry.turnId,
      liveMessageId: entry.liveMessageId,
      entry,
    });
    const publicationCount = () =>
      harness.publicationAttempts.filter(
        (event) => event.type === "conversation.entry.appended",
      ).length;
    assert.equal(publicationCount(), 1);

    await harness.flushEvents();
    assert.equal(publicationCount(), 1);
  }
});

test("execution sink publishes bounded notify progress off the sequenced path", async () => {
  const harness = fixture();
  await start(harness.coordinator);
  harness.sinks[0]!.progress({
    type: "assistant.delta",
    occurredAt: "2026-07-12T00:00:10.000Z",
    data: { text: "partial" },
  });
  assert.equal(harness.notifyEvents.length, 1);
  assert.equal(harness.notifyEvents[0]?.type, "assistant.delta");
  // Notify progress never becomes a sequenced intent.
  assert.equal(
    [...harness.published.keys()].some((id) => id.endsWith("assistant.delta")),
    false,
  );
});

test("execution sink enters a durable wait and resolves exactly once", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const interaction = await harness.sinks[0]!.wait({
    kind: "approval",
    toolCallId: "tool_write",
    prompt: "Allow write?",
    risk: ["filesystem"],
    normalizedArgs: { path: "/tmp/x" },
    offeredScopes: ["single_call"],
    checkpoint: {
      boundary: "suspension",
      transcriptCursor: 0,
      entryIds: [],
      harnessLeafId: null,
      harnessSavePointId: "save_0",
      toolCalls: [],
    },
  });
  assert.equal(
    (await harness.coordinator.get(run.runId))?.run.status,
    "waiting",
  );
  const resolved = await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: interaction.id,
    resolutionRequestId: "req_1",
    resolution: { decision: "allow" },
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(
    (await harness.coordinator.get(run.runId))?.run.status,
    "suspended",
  );
});

test("recovery fails an interrupted run without a valid checkpoint", async () => {
  const harness = fixture();
  const run = await start(harness.coordinator);
  const recovered = await harness.coordinator.recover();
  const state = recovered.find((item) => item.runId === run.runId);
  assert.equal(state?.status, "failed");
  assert.equal(state?.failure?.code, "INVALID_CHECKPOINT");
  const recoveredState = await harness.coordinator.get(run.runId);
  assert.equal(
    (
      recoveredState?.transitions.at(-1)?.events[0]?.data as
        | { continuable?: boolean }
        | undefined
    )?.continuable,
    undefined,
  );
});

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for coordinator state");
}
