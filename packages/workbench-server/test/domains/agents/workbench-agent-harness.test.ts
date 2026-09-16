import assert from "node:assert/strict";
import test from "node:test";
import type { AnyModel } from "@nervekit/harness/agent";
import { createWorkbenchAgentHarness } from "../../../src/domains/agents/execution/workbench-agent-harness.js";

const model = {
  id: "test-model",
  name: "Test model",
  api: "anthropic",
  provider: "anthropic",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_024,
} as unknown as AnyModel;

test("workbench harness applies a bounded provider request timeout", () => {
  const harness = createWorkbenchAgentHarness({
    env: {} as never,
    conversation: {} as never,
    model,
    systemPrompt: "test",
    streamOptions: { headers: { "x-test": "preserved" } },
  });

  assert.equal(harness.getStreamOptions().timeoutMs, 600_000);
  assert.deepEqual(harness.getStreamOptions().headers, {
    "x-test": "preserved",
  });
});
