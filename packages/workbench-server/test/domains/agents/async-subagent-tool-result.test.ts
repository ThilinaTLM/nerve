import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { subagentToolResult } from "../../../src/domains/agents/async-subagent-tool-result.js";

describe("subagentToolResult", () => {
  it("keeps agent ids in UI details but not in model content", () => {
    const status = {
      agentId: "agent_child",
      name: "ui",
      state: "idle" as const,
      runId: "run_1",
    };
    const single = subagentToolResult(status);
    assert.equal(single.details, status);
    assert.deepEqual(JSON.parse(single.content), {
      name: "ui",
      state: "idle",
      runId: "run_1",
    });

    const list = subagentToolResult({
      subagents: [status],
      nextCursor: "agent_child",
    });
    assert.deepEqual(JSON.parse(list.content), {
      subagents: [{ name: "ui", state: "idle", runId: "run_1" }],
      nextCursor: "agent_child",
    });
    assert.ok(!list.content.includes('"agentId"'));
  });
});
