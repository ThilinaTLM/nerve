import type {
  ConversationActiveRunSnapshot,
  QueuedPromptRecord,
} from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  it("cancels the exact run captured before the local projection", async () => {
    const calls: Array<{ agentId: string; runId?: string }> = [];
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
      cancelRun: async (agentId, runId) => {
        calls.push({ agentId, runId });
      },
      notifyError: () => undefined,
    });

    await abort();

    assert.deepEqual(calls, [{ agentId: "agent_1", runId: "run_1" }]);
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
});
