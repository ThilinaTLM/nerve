import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationActiveRunSnapshot,
  QueuedPromptRecord,
} from "$lib/api";
import {
  createAbortActiveRun,
  type AbortableConversationView,
} from "./run-abort";

function activeRun(
  status: ConversationActiveRunSnapshot["status"] = "running",
): ConversationActiveRunSnapshot {
  return {
    runId: "run_1",
    agentId: "agent_1",
    conversationId: "conv_1",
    projectId: "proj_1",
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: [],
  } as ConversationActiveRunSnapshot;
}

function queuedPrompt(): QueuedPromptRecord {
  return { id: "prompt_1" } as QueuedPromptRecord;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("abort active run", () => {
  it("projects aborting synchronously and clears queued prompts", async () => {
    const cancellation = deferred<void>();
    const view: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: activeRun(),
      queuedPrompts: [queuedPrompt()],
    };
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => view,
      cancelRun: () => cancellation.promise,
      notifyError: () => undefined,
    });
    const result = abort();
    // The projection lands before the RPC can settle.
    assert.equal(view.activeRun?.status, "aborting");
    assert.equal(view.stopping, true);
    assert.equal(view.sending, true);
    assert.deepEqual(view.queuedPrompts, []);
    cancellation.resolve();
    await result;
  });

  it("suppresses duplicate Stop clicks while cancellation is in flight", async () => {
    const cancellation = deferred<void>();
    let calls = 0;
    const view: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: activeRun(),
      queuedPrompts: [],
    };
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => view,
      cancelRun: () => {
        calls += 1;
        return cancellation.promise;
      },
      notifyError: () => undefined,
    });
    const first = abort();
    const second = abort();
    assert.equal(calls, 1);
    await second;
    cancellation.resolve();
    await first;
  });

  it("applies a local terminal fallback after a successful acknowledgment", async () => {
    const view: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: activeRun(),
      queuedPrompts: [queuedPrompt()],
    };
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => view,
      cancelRun: async () => undefined,
      notifyError: () => undefined,
    });
    await abort();
    assert.equal(view.sending, false);
    assert.equal(view.stopping, false);
    assert.equal(view.activeRun, undefined);
    assert.deepEqual(view.queuedPrompts, []);
  });

  it("restores the prior projection and notifies on failure", async () => {
    const previousRun = activeRun();
    const previousPrompts = [queuedPrompt()];
    const view: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: previousRun,
      queuedPrompts: previousPrompts,
    };
    const notifications: Array<{ title: string; description: string }> = [];
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => view,
      cancelRun: async () => {
        throw new Error("connection lost");
      },
      notifyError: (title, options) =>
        notifications.push({ title, description: options.description }),
    });
    await abort();
    assert.equal(view.sending, true);
    assert.equal(view.stopping, false);
    assert.equal(view.activeRun, previousRun);
    assert.equal(view.queuedPrompts, previousPrompts);
    assert.deepEqual(notifications, [
      { title: "Could not stop the run", description: "connection lost" },
    ]);
  });

  it("applies the acknowledgment fallback to a replaced view object", async () => {
    const cancellation = deferred<void>();
    const initial: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: activeRun(),
      queuedPrompts: [queuedPrompt()],
    };
    let current = initial;
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => current,
      cancelRun: () => cancellation.promise,
      notifyError: () => undefined,
    });

    const result = abort();
    current = {
      ...initial,
      activeRun: initial.activeRun ? { ...initial.activeRun } : undefined,
      queuedPrompts: [...initial.queuedPrompts],
    };
    cancellation.resolve();
    await result;

    assert.equal(current.sending, false);
    assert.equal(current.stopping, false);
    assert.equal(current.activeRun, undefined);
    assert.deepEqual(current.queuedPrompts, []);
  });

  it("does not resurrect a run when its terminal event beats an RPC failure", async () => {
    const cancellation = deferred<void>();
    let current: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: activeRun(),
      queuedPrompts: [],
    };
    const notifications: string[] = [];
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => current,
      cancelRun: () => cancellation.promise,
      notifyError: (title) => notifications.push(title),
    });

    const result = abort();
    current = {
      conversationId: "conv_1",
      sending: false,
      stopping: false,
      activeRun: undefined,
      queuedPrompts: [],
    };
    cancellation.reject(new Error("connection lost after commit"));
    await result;

    assert.equal(current.activeRun, undefined);
    assert.equal(current.sending, false);
    assert.equal(current.stopping, false);
    assert.deepEqual(notifications, []);
  });

  it("does not clear a newer run after a late cancellation acknowledgment", async () => {
    const cancellation = deferred<void>();
    let current: AbortableConversationView = {
      conversationId: "conv_1",
      sending: true,
      stopping: false,
      activeRun: activeRun(),
      queuedPrompts: [],
    };
    const abort = createAbortActiveRun({
      agentId: () => "agent_1",
      view: () => current,
      cancelRun: () => cancellation.promise,
      notifyError: () => undefined,
    });

    const result = abort();
    current = {
      conversationId: "conv_1",
      sending: true,
      // A run.started projection can inherit the old app-only latch.
      stopping: true,
      activeRun: { ...activeRun(), runId: "run_2" },
      queuedPrompts: [queuedPrompt()],
    };
    cancellation.resolve();
    await result;

    assert.equal(current.activeRun?.runId, "run_2");
    assert.equal(current.sending, true);
    assert.equal(current.stopping, false);
    assert.deepEqual(current.queuedPrompts, [queuedPrompt()]);
  });

  it("does nothing when no agent is selected", async () => {
    let calls = 0;
    const abort = createAbortActiveRun({
      agentId: () => undefined,
      view: () => undefined,
      cancelRun: async () => {
        calls += 1;
      },
      notifyError: () => undefined,
    });
    await abort();
    assert.equal(calls, 0);
  });
});
