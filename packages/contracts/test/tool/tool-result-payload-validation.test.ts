import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeLegacyToolCallRecord,
  toolCallRecordSchema,
  toolResultPayloadReferenceSchema,
} from "../../src/domains/tools/index.js";

const reference = {
  version: 2 as const,
  kind: "tool_result" as const,
  logicalPath: "conversations/test/tool-calls/test/result.json",
  conversationId: "conv_test",
  toolCallId: "tool_test",
  digest: "a".repeat(64),
  byteLength: 42,
  mediaType: "application/json" as const,
  encoding: "utf-8" as const,
  completeness: "complete" as const,
};

describe("stored tool-call compatibility", () => {
  it("infers rule-set evidence omitted before v0.27", () => {
    const now = "2026-08-25T00:00:00.000Z";
    const legacy = {
      id: "tool_legacy",
      agentId: "agent_test",
      conversationId: "conv_test",
      projectId: "proj_test",
      toolName: "read",
      risk: "read",
      args: { path: "README.md" },
      cwd: "/tmp/project",
      status: "running",
      revision: 1,
      attempt: 1,
      interactions: [],
      permissionEvaluation: {
        decision: "allow",
        reason: "Legacy permission decision.",
        baseRisk: "read",
        normalizedTargets: [{ kind: "whole_tool" }],
        winningRuleId: "allow-read",
        winningRule: {
          id: "allow-read",
          enabled: true,
          priority: 10,
          enforcement: "overridable",
          when: { baseRisks: ["read"] },
          decision: "allow",
        },
        winningRuleOrigin: "rule_set",
        winningRuleEnforcement: "overridable",
        winningRulePrecedence: {
          enforcementRank: 0,
          scopeRank: 1,
          priority: 10,
        },
        activeRuleSetIds: ["baseline", "autonomous"],
        ignoredOverlays: [],
        policySnapshotHash: `sha256:${"0".repeat(64)}`,
        suggestedRules: [],
      },
      createdAt: now,
      updatedAt: now,
    };

    assert.equal(toolCallRecordSchema.safeParse(legacy).success, false);
    const parsed = toolCallRecordSchema.parse(
      normalizeLegacyToolCallRecord(legacy as never),
    );
    assert.equal(parsed.permissionEvaluation?.selectedRuleSetId, "autonomous");
    assert.equal(parsed.permissionEvaluation?.winningRuleSetId, "autonomous");
  });
});

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
