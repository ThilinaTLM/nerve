import assert from "node:assert/strict";
import { it } from "node:test";
import { WorkbenchAgentMechanics } from "../../../src/domains/agents/execution/workbench-agent-mechanics.js";

function fixture(cancelAt?: "preflight" | "anchor" | "recovery") {
  const controller = new AbortController();
  const calls: string[] = [];
  const agent = {
    id: "agent",
    conversationId: "conversation",
    projectDir: "/tmp/project",
    model: { provider: "xai", modelId: "grok-4.5" },
  };
  const assistant = {
    role: "assistant",
    content: [],
    stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  };
  const mechanics = {
    deps: { state: { agents: new Map([[agent.id, agent]]) } },
    customModels: async () => [],
    autoCompaction: {
      maybeCompactBeforePrompt: async () => {
        calls.push("preflight");
        await Promise.resolve();
        if (cancelAt === "preflight") controller.abort();
        return {
          status: cancelAt === "preflight" ? "cancelled" : "not_needed",
        };
      },
    },
    tryOverflowCompactionRecovery: async () => {
      calls.push("recovery");
      await Promise.resolve();
      controller.abort();
      return { status: "compacted" };
    },
  };
  const input = {
    agent,
    runId: "run",
    request: { text: "test" },
    continue: false,
    signal: controller.signal,
    conversation: {
      getBranch: async () => {
        calls.push("anchor");
        await Promise.resolve();
        if (cancelAt === "anchor") controller.abort();
        return [];
      },
    },
    harness: {
      prompt: async () => {
        calls.push("prompt");
        return cancelAt === "recovery"
          ? {
              ...assistant,
              stopReason: "error",
              errorMessage: "prompt is too long",
            }
          : assistant;
      },
      continue: async () => {
        calls.push("continue");
        return assistant;
      },
    },
  };
  return {
    controller,
    calls,
    input,
    run: () =>
      WorkbenchAgentMechanics.prototype.runHarnessAttempt.call(
        mechanics as never,
        input as never,
      ),
  };
}

for (const cancelAt of ["preflight", "anchor", "recovery"] as const) {
  it(`does not start further harness work after cancellation during ${cancelAt}`, async () => {
    const f = fixture(cancelAt);
    await assert.rejects(f.run(), { name: "AbortError" });
    assert.deepEqual(
      f.calls,
      cancelAt === "preflight"
        ? ["preflight"]
        : cancelAt === "anchor"
          ? ["preflight", "anchor"]
          : ["preflight", "anchor", "prompt", "recovery"],
    );
  });
}

it("does not start an already-cancelled continuation", async () => {
  const f = fixture();
  f.input.continue = true;
  f.controller.abort();
  await assert.rejects(f.run(), { name: "AbortError" });
  assert.deepEqual(f.calls, []);
});

it("runs a non-cancelled prompt and continuation normally", async () => {
  const f = fixture();
  await f.run();
  f.input.continue = true;
  await f.run();
  assert.deepEqual(f.calls, ["preflight", "anchor", "prompt", "continue"]);
});
