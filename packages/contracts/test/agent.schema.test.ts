import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentRecordSchema } from "../src/domains/agents/agent.schema.js";

function baseAgent(): Record<string, unknown> {
  return {
    id: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H00000000000000000000000",
    projectDir: "/home/user/project",
    rootAgentId: "agent_01H00000000000000000000000",
    mode: "coding",
    permissionLevel: "read_only",
    workspaceScope: { roots: ["/home/user/project"] },
    status: "idle",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

describe("agent record schema", () => {
  it("parses records without a task (legacy agents)", () => {
    const agent = agentRecordSchema.parse(baseAgent());
    assert.equal(agent.task, undefined);
  });

  it("round-trips an optional subagent task", () => {
    const agent = agentRecordSchema.parse({
      ...baseAgent(),
      parentAgentId: "agent_01H00000000000000000000001",
      task: "Explore the repo for auth patterns",
    });
    assert.equal(agent.task, "Explore the repo for auth patterns");
  });
});
