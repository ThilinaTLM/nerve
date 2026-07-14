import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts";
import { executeWorkbenchHarness } from "../src/domains/agents/run/workbench-harness-execution.js";

describe("workbench harness failure classification", () => {
  it("classifies host-side execution failures separately from model failures", async () => {
    const agent = {
      id: "agent_01H00000000000000000000000",
      conversationId: "conv_01H00000000000000000000000",
      projectId: "proj_01H00000000000000000000000",
      projectDir: "/tmp/project",
    } as AgentRecord;
    const mechanics = {
      deps: {
        logger: {
          info: async () => {
            throw new Error("host projection failed");
          },
        },
      },
      suspensionFromWaitingToolCall: () => undefined,
    };

    const outcome = await executeWorkbenchHarness.call(
      mechanics as never,
      agent,
      { text: "hello", behavior: "prompt" } as never,
      {
        coordinator: {
          run: { runId: "run_01H00000000000000000000000" },
          sink: {},
          command: "start",
          signal: new AbortController().signal,
          installControl: () => undefined,
          checkpointCommand: async () => {
            throw new Error("not reached");
          },
        } as never,
      },
    );

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.failure?.code, "EXECUTION_FAILED");
    assert.match(outcome.failure?.message ?? "", /host projection failed/);
  });
});
