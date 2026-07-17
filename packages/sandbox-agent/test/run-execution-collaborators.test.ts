import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createNoopLogger,
  type ConversationEntry,
  type RunPromptRecord,
  type RunRecord,
  type ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { RunExecutionSink } from "@nervekit/host-runtime";
import type { AgentHarnessEvent } from "@nervekit/host-runtime/harness";
import type { HarnessFactory } from "../src/agent/harness-factory.js";
import { SandboxInteractionChannel } from "../src/run/interaction-channel.js";
import { SandboxLiveHarnessRegistry } from "../src/run/live-registry.js";
import { SandboxPendingInteractions } from "../src/run/pending-interactions.js";
import {
  assistantFailure,
  normalizeFailure,
} from "../src/run/run-execution-errors.js";
import { SandboxHarnessSession } from "../src/run/run-harness-session.js";
import { SandboxInlineCommandRunner } from "../src/run/run-inline-command.js";
import { SandboxInteractionContinuation } from "../src/run/run-interaction-continuation.js";
import {
  SandboxPromptControl,
  type SandboxHarnessPromptPort,
} from "../src/run/run-prompt-control.js";
import {
  SandboxToolCallTracker,
  toolTranscriptId,
} from "../src/run/run-tool-call-tracker.js";
import type { SandboxRunReferences } from "../src/run/run-references.js";
import type { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

const scope = {
  conversationId: "conv_test",
  agentId: "agent_test",
  runId: "run_test",
  executionId: "exec_test",
};

function runRecord(): RunRecord {
  return {
    stateEpoch: 1,
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
    scopeId: "conv_test:agent_test",
    revision: 1,
    status: "running",
    recoverability: "none",
    executionId: "exec_test",
    attempt: 1,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    cancellationEvidence: [],
  } as unknown as RunRecord;
}

function promptRecord(id: string, text: string): RunPromptRecord {
  return { id, text } as unknown as RunPromptRecord;
}

function recordingSink() {
  const entries: ConversationEntry[] = [];
  const toolCalls: ToolCallTranscriptRecord[] = [];
  const waits: unknown[] = [];
  const sink = {
    appendEntries: async (appended: readonly ConversationEntry[]) => {
      entries.push(...appended);
    },
    upsertToolCalls: async (upserted: readonly ToolCallTranscriptRecord[]) => {
      toolCalls.push(...upserted);
    },
    promptDelivered: async () => {},
    checkpoint: async () => ({}) as never,
    wait: async (command: unknown) => {
      waits.push(command);
      return {} as never;
    },
    waitMany: async () => [] as never,
    progress: () => {},
  } satisfies RunExecutionSink;
  return { sink, entries, toolCalls, waits };
}

function fakeToolRuntime(
  execute: (
    toolName: string,
    args: unknown,
  ) => Promise<{ content: string; exitCode?: number }>,
) {
  const calls: Array<{ toolName: string; args: unknown }> = [];
  const runtime = {
    execute: async (toolName: string, args: unknown) => {
      calls.push({ toolName, args });
      return execute(toolName, args);
    },
  } as unknown as SandboxToolRuntime;
  return { runtime, calls };
}

function tracker(run = runRecord()) {
  return new SandboxToolCallTracker({
    run,
    cwd: "/workspace",
    anchors: { resolveToolAnchor: () => undefined },
  });
}

describe("SandboxPromptControl", () => {
  it("buffers pre-turn prompts in order and delivers them after turn start", async () => {
    const delivered: Array<{ kind: string; id: string; text: string }> = [];
    const port: SandboxHarnessPromptPort = {
      steer: async (text, options) => {
        delivered.push({ kind: "steer", id: options.id, text });
      },
      followUp: async (text, options) => {
        delivered.push({ kind: "follow-up", id: options.id, text });
      },
      removeQueuedMessage: async () => false,
    };
    const control = new SandboxPromptControl({
      harness: () => port,
      scope,
      signal: new AbortController().signal,
    });
    await control.steer(promptRecord("p1", "first"));
    await control.followUp(promptRecord("p2", "second"));
    assert.equal(delivered.length, 0, "prompts buffer until turn start");
    await control.deliverPending();
    assert.deepEqual(
      delivered.map((item) => item.id),
      ["p1", "p2"],
    );
    assert.deepEqual(
      delivered.map((item) => item.kind),
      ["steer", "follow-up"],
    );
  });

  it("removes a buffered prompt before delivery", async () => {
    const delivered: string[] = [];
    const port: SandboxHarnessPromptPort = {
      steer: async (_text, options) => {
        delivered.push(options.id);
      },
      followUp: async (_text, options) => {
        delivered.push(options.id);
      },
      removeQueuedMessage: async () => false,
    };
    const control = new SandboxPromptControl({
      harness: () => port,
      scope,
      signal: new AbortController().signal,
    });
    await control.steer(promptRecord("p1", "first"));
    await control.steer(promptRecord("p2", "second"));
    assert.equal(await control.removeQueuedPrompt("p1"), true);
    await control.deliverPending();
    assert.deepEqual(delivered, ["p2"]);
  });

  it("expands executable command blocks at delivery time", async () => {
    const { runtime, calls } = fakeToolRuntime(async () => ({
      content: "expanded output",
      exitCode: 0,
    }));
    const delivered: string[] = [];
    const port: SandboxHarnessPromptPort = {
      steer: async (text) => {
        delivered.push(text);
      },
      followUp: async (text) => {
        delivered.push(text);
      },
      removeQueuedMessage: async () => false,
    };
    const control = new SandboxPromptControl({
      harness: () => port,
      toolRuntime: runtime,
      scope,
      signal: new AbortController().signal,
    });
    await control.steer(
      promptRecord("p1", "Run this:\n```!!!\necho hi\n```\nthanks"),
    );
    assert.equal(calls.length, 0, "expansion happens at delivery time");
    await control.deliverPending();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, { command: "echo hi" });
    assert.match(delivered[0] ?? "", /expanded output/);
    assert.doesNotMatch(delivered[0] ?? "", /!!!/);
  });
});

describe("SandboxHarnessSession projection", () => {
  function sessionFixture() {
    let subscriber:
      | ((event: AgentHarnessEvent) => unknown | Promise<unknown>)
      | undefined;
    const harness = {
      subscribe: (callback: (event: AgentHarnessEvent) => unknown) => {
        subscriber = callback;
        return () => {
          subscriber = undefined;
        };
      },
    };
    const live = new SandboxLiveHarnessRegistry();
    const session = new SandboxHarnessSession({
      scope,
      harnessFactory: {
        create: async () => harness,
      } as unknown as HarnessFactory,
      live,
      log: createNoopLogger(),
    });
    return {
      session,
      live,
      emit: (event: AgentHarnessEvent) => subscriber?.(event),
      isSubscribed: () => subscriber !== undefined,
    };
  }

  it("serializes projections and registers/unregisters the live handle", async () => {
    const order: string[] = [];
    const { session, live, emit } = sessionFixture();
    await session.open(async (event) => {
      if (event.type === "turn_start") {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      order.push(event.type);
    });
    assert.ok(live.get("run_test"), "live handle registered on open");
    emit({ type: "turn_start" } as AgentHarnessEvent);
    emit({ type: "turn_end" } as AgentHarnessEvent);
    await session.waitForProjection();
    assert.deepEqual(order, ["turn_start", "turn_end"]);
    session.dispose();
    assert.equal(live.get("run_test"), undefined);
  });

  it("returns the rejecting projection for queue_drained so the queue can roll back", async () => {
    const { session, emit } = sessionFixture();
    await session.open(async (event) => {
      if (event.type === "queue_drained") {
        throw new Error("delivery failed");
      }
    });
    const result = emit({
      type: "queue_drained",
      messageIds: ["p1"],
    } as unknown as AgentHarnessEvent);
    assert.ok(
      result instanceof Promise,
      "queue_drained returns the projection",
    );
    await assert.rejects(result as Promise<unknown>, /delivery failed/);
    // The projection tail swallows the logged failure and stays usable.
    await session.waitForProjection();
    session.dispose();
  });
});

describe("SandboxToolCallTracker", () => {
  it("keeps deterministic ids and createdAt across lifecycle revisions", async () => {
    const calls = tracker();
    const started = calls.record("prov_1", "bash", "running", {
      command: "ls",
    });
    assert.ok(started);
    assert.equal(started.id, toolTranscriptId("prov_1"));
    assert.equal(started.risk, "command");
    assert.equal(started.cwd, "/workspace");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const completed = calls.record("prov_1", "bash", "completed", undefined, {
      content: "output",
    });
    assert.ok(completed);
    assert.equal(completed.id, started.id);
    assert.equal(completed.createdAt, started.createdAt);
    assert.deepEqual(completed.argsPreview, { command: "ls" });
    assert.equal(completed.resultPreview, "output");
  });

  it("rejects unknown tool names and marks waiting revisions by kind", () => {
    const calls = tracker();
    assert.equal(calls.record("prov_x", "not-a-tool", "running"), undefined);
    calls.record("prov_1", "bash", "running", { command: "ls" });
    const approval = calls.markWaiting("prov_1", "approval");
    assert.equal(approval?.status, "pending_approval");
    calls.record("prov_2", "ask_user", "running", {});
    const question = calls.markWaiting("prov_2", "question");
    assert.equal(question?.status, "waiting_for_user");
    assert.equal(calls.markWaiting("prov_unknown", "question"), undefined);
  });
});

describe("SandboxInlineCommandRunner", () => {
  it("records tool lifecycle and a formatted system entry on success", async () => {
    const { sink, entries, toolCalls } = recordingSink();
    const { runtime } = fakeToolRuntime(async () => ({
      content: "hello\n",
      exitCode: 0,
    }));
    const runner = new SandboxInlineCommandRunner({
      run: runRecord(),
      sink,
      scope,
      signal: new AbortController().signal,
      toolRuntime: runtime,
      toolCalls: tracker(),
    });
    assert.equal(runner.detect("!echo hi"), "echo hi");
    assert.equal(runner.detect("plain prompt"), undefined);
    const outcome = await runner.execute("echo hi");
    assert.deepEqual(outcome, { status: "completed" });
    assert.deepEqual(
      toolCalls.map((call) => call.status),
      ["running", "completed"],
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.role, "system");
    assert.match(entries[0]?.text ?? "", /\$ echo hi/);
    assert.match(entries[0]?.text ?? "", /status: completed/);
  });

  it("maps runtime failures and missing runtimes to failed outcomes", async () => {
    const { sink } = recordingSink();
    const { runtime } = fakeToolRuntime(async () => {
      throw new Error("command blew up");
    });
    const failing = new SandboxInlineCommandRunner({
      run: runRecord(),
      sink,
      scope,
      signal: new AbortController().signal,
      toolRuntime: runtime,
      toolCalls: tracker(),
    });
    const failed = await failing.execute("boom");
    assert.equal(failed.status, "failed");
    assert.match(
      (failed as { failure?: { message?: string } }).failure?.message ?? "",
      /command blew up/,
    );

    const unavailable = new SandboxInlineCommandRunner({
      run: runRecord(),
      sink,
      scope,
      signal: new AbortController().signal,
      toolCalls: tracker(),
    });
    const missing = await unavailable.execute("echo hi");
    assert.equal(missing.status, "failed");
    assert.equal(
      (missing as { failure?: { code?: string } }).failure?.code,
      "UNAVAILABLE",
    );
  });
});

describe("SandboxInteractionContinuation", () => {
  function continuationFixture(options: {
    interaction: Record<string, unknown>;
    previousToolCalls?: Array<Record<string, unknown>>;
    existingEntryIds?: string[];
    executeResult?: { content: string };
  }) {
    const { sink, toolCalls: sunkToolCalls, waits } = recordingSink();
    const appended: Array<{ entryId: string; message: unknown }> = [];
    const existing = new Set(options.existingEntryIds ?? []);
    const { runtime, calls } = fakeToolRuntime(async () => {
      return options.executeResult ?? { content: "tool ran" };
    });
    const references = {
      loadRun: async () => ({
        run: runRecord(),
        interactions: [options.interaction],
        transitions: [{ toolCalls: options.previousToolCalls ?? [] }],
        prompts: [],
        checkpoints: [],
        deliveries: [],
      }),
      transcript: async () => ({
        cursor: 0,
        entryIds: [],
        harnessLeafId: null,
        harnessSavePointId: "save_0",
      }),
      toolCalls: async () => [],
    } as unknown as SandboxRunReferences;
    const harnessFactory = {
      openOrCreateConversation: async () => ({
        getEntry: async (entryId: string) =>
          existing.has(entryId) ? { id: entryId } : undefined,
      }),
      appendConversationMessage: async (
        _conversationId: string,
        _agentId: string,
        entryId: string,
        message: unknown,
      ) => {
        appended.push({ entryId, message });
        existing.add(entryId);
      },
    } as unknown as HarnessFactory;
    const continuation = new SandboxInteractionContinuation({
      run: runRecord(),
      sink,
      scope,
      signal: new AbortController().signal,
      references,
      harnessFactory,
      toolRuntime: runtime,
      channel: new SandboxInteractionChannel(),
      pending: new SandboxPendingInteractions(),
      toolCalls: tracker(),
    });
    return { continuation, appended, calls, sunkToolCalls, waits };
  }

  const approvalInteraction = (decision: "allow" | "deny") => ({
    id: "int_1",
    kind: "approval",
    status: "resolved",
    conversationId: "conv_test",
    agentId: "agent_test",
    toolCallId: "prov_1",
    normalizedArgs: { command: "rm -rf ./tmp" },
    resolution: { decision },
    resolutionRequestId: "req_1",
    createdAt: "2026-07-17T00:00:00.000Z",
  });

  it("executes an approved tool call and materializes its result once", async () => {
    const fixture = continuationFixture({
      interaction: approvalInteraction("allow"),
      previousToolCalls: [
        { providerToolCallId: "prov_1", toolName: "bash", id: "tool_x" },
      ],
      executeResult: { content: "approved output" },
    });
    await fixture.continuation.materializeResolved();
    assert.equal(fixture.calls.length, 1, "approved tool executes");
    assert.deepEqual(fixture.calls[0]?.args, { command: "rm -rf ./tmp" });
    assert.equal(fixture.appended.length, 1);
    assert.equal(fixture.sunkToolCalls[0]?.status, "completed");

    // Idempotent: the deterministic entry already exists on the second pass.
    await fixture.continuation.materializeResolved();
    assert.equal(fixture.appended.length, 1);
    assert.equal(fixture.calls.length, 1);
  });

  it("records a denied tool call without executing it", async () => {
    const fixture = continuationFixture({
      interaction: approvalInteraction("deny"),
      previousToolCalls: [
        { providerToolCallId: "prov_1", toolName: "bash", id: "tool_x" },
      ],
    });
    await fixture.continuation.materializeResolved();
    assert.equal(fixture.calls.length, 0, "denied tool never executes");
    assert.equal(fixture.sunkToolCalls[0]?.status, "denied");
    assert.equal(fixture.appended.length, 1);
    const message = fixture.appended[0]?.message as {
      content?: Array<{ text?: string }>;
    };
    assert.match(message.content?.[0]?.text ?? "", /denied/i);
  });
});

describe("failure classification", () => {
  it("classifies transient and permanent provider failures", () => {
    assert.equal(assistantFailure("rate limit exceeded 429").retryable, true);
    assert.equal(assistantFailure("service unavailable 503").retryable, true);
    assert.equal(
      assistantFailure("insufficient_quota for org").retryable,
      false,
    );
    assert.equal(
      assistantFailure("maximum context length exceeded").retryable,
      false,
    );
    assert.equal(assistantFailure(undefined).retryable, false);
    assert.equal(assistantFailure("x").code, "MODEL_REQUEST_FAILED");
  });

  it("normalizes unexpected errors with bounded messages", () => {
    const unavailable = normalizeFailure(
      new Error("UNAVAILABLE: harness session is not open"),
    );
    assert.equal(unavailable.code, "UNAVAILABLE");
    const generic = normalizeFailure(new Error("boom"));
    assert.equal(generic.code, "PROVIDER_FAILED");
    assert.equal(generic.retryable, true);
    const oversized = normalizeFailure(new Error("y".repeat(5_000)));
    assert.ok(oversized.message.length <= 2_000);
  });
});
