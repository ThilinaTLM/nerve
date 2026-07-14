import assert from "node:assert/strict";
import test from "node:test";
import type {
  PeerRole,
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
    sourceRole?: PeerRole;
    execute?: (
      attempt: number,
      input: Parameters<RunExecution["execute"]>[0],
      sink: RunExecutionSink,
    ) => Promise<RunExecutionOutcome>;
    retryPolicy?: { enabled: boolean; maxRetries: number; baseDelayMs: number };
    observerFails?: boolean;
    retryDelay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const unitOfWork = new MemoryUnitOfWork();
  const published = new Map<string, { eventId: string; sequence: number }>();
  const publicationAttempts: RunPublicEventIntent[] = [];
  const controls: Array<{ behavior: string; text: string }> = [];
  const controlPrompts: import("@nervekit/contracts").RunPromptRecord[] = [];
  const executions: RunExecution[] = [];
  const sinks: RunExecutionSink[] = [];
  const transient: RunProgressEvent[] = [];
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
    transient: { publish: (event) => transient.push(event) },
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
            continue: async () => undefined,
            cancel: async () => undefined,
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
    flushEvents: () => delivery.flush(),
  });
  return {
    coordinator,
    unitOfWork,
    published,
    publicationAttempts,
    controls,
    controlPrompts,
    executions,
    sinks,
    transient,
    executionInputs,
    observed,
    finishExecution,
    flushEvents: () => delivery.flush(),
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
  await deliveredHarness.coordinator.steer(deliveredRun.runId, "delivered");
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
  assert.equal((retry?.data as { attempt?: number })?.attempt, 2);
  assert.equal((retry?.data as { maxRetries?: number })?.maxRetries, 2);
  assert.equal((retry?.data as { delayMs?: number })?.delayMs, 25);
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

test("terminally completes only a resolved suspended interaction", async () => {
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
    } as never,
    checkpoint: {
      boundary: "suspension",
      transcriptCursor: 0,
      entryIds: [],
      harnessLeafId: null,
      harnessSavePointId: "save_0",
      toolCalls: [],
    },
  });
  await assert.rejects(
    harness.coordinator.completeResolvedInteraction(run.runId, interaction.id),
  );
  await harness.coordinator.resolveInteraction(run.runId, {
    interactionId: interaction.id,
    resolutionRequestId: "request_terminal",
    resolution: { decision: "reject" },
  });
  const completed = await harness.coordinator.completeResolvedInteraction(
    run.runId,
    interaction.id,
  );
  assert.equal(completed.status, "completed");
  assert.equal(
    (await harness.coordinator.get(run.runId))?.transitions.at(-1)?.kind,
    "resolved_interaction_completed",
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

test("execution sink publishes bounded transient progress off the durable path", async () => {
  const harness = fixture();
  await start(harness.coordinator);
  harness.sinks[0]!.progress({
    type: "assistant.delta",
    occurredAt: "2026-07-12T00:00:10.000Z",
    data: { text: "partial" },
  });
  assert.equal(harness.transient.length, 1);
  assert.equal(harness.transient[0]?.type, "assistant.delta");
  // Transient progress never becomes a durable intent.
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
