import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toolCallRecordSchema,
  toolResultPayloadReferenceSchema,
} from "../../src/domains/tools/index.js";

const reference = {
  version: 1 as const,
  kind: "tool_result" as const,
  logicalPath:
    "payloads/conversations/conv_test/tool-calls/tool_test/result.json",
  conversationId: "conv_test",
  toolCallId: "tool_test",
  digest: "a".repeat(64),
  byteLength: 42,
  mediaType: "application/json" as const,
  encoding: "utf-8" as const,
  completeness: "complete" as const,
};

describe("tool-result payload reference", () => {
  it("accepts a transport-safe owner and digest descriptor", () => {
    assert.deepEqual(
      toolResultPayloadReferenceSchema.parse(reference),
      reference,
    );
  });

  it("rejects paths and mismatched tool-call ownership", () => {
    assert.equal(
      toolResultPayloadReferenceSchema.safeParse({
        ...reference,
        path: "/home/user/.nerve/payload.json",
      }).success,
      false,
    );
    const now = "2026-08-25T00:00:00.000Z";
    assert.equal(
      toolCallRecordSchema.safeParse({
        id: "tool_other",
        agentId: "agent_test",
        conversationId: "conv_test",
        projectId: "proj_test",
        toolName: "bash",
        risk: "command",
        args: { command: "test" },
        cwd: "/tmp/project",
        status: "completed",
        revision: 1,
        attempt: 1,
        interactions: [],
        result: "bounded",
        resultPayload: reference,
        createdAt: now,
        updatedAt: now,
        settledAt: now,
      }).success,
      false,
    );
  });
});
