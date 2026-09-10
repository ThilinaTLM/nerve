import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ToolCallRecord,
  ToolInteraction,
} from "@nervekit/contracts/tools";
import {
  projectApproval,
  projectApprovals,
  projectQuestions,
} from "../../../src/domains/tools/orchestration/tool-interaction-projection.js";

const now = "2026-09-01T00:00:00.000Z";
function call(interactions: ToolInteraction[]): ToolCallRecord {
  return {
    id: "tool_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "read",
    risk: "read",
    args: {},
    cwd: "/tmp/project",
    status: "waiting",
    revision: 1,
    attempt: 1,
    interactions,
    createdAt: now,
    updatedAt: now,
  };
}
const approval: ToolInteraction = {
  ordinal: 0,
  kind: "approval",
  status: "pending",
  requestedAt: now,
  updatedAt: now,
  request: {
    risk: "read",
    reason: "Review",
    offeredScopes: [
      "single_call",
      "run",
      "always",
      "always_user",
      "always_project",
    ],
    suggestedExceptions: [],
    suggestedRules: [],
  },
};
const question: ToolInteraction = {
  ordinal: 0,
  kind: "user_input",
  status: "pending",
  requestedAt: now,
  updatedAt: now,
  request: { question: "Proceed?", required: true },
};

test("pending approvals require actionability; resolved history remains available", () => {
  const pending = call([approval]);
  const resolved = call([
    {
      ...approval,
      status: "resolved",
      resolution: { action: "allow", note: "Reviewed" },
      resolvedAt: now,
    },
  ]);
  assert.deepEqual(
    projectApprovals([pending], () => false),
    [],
  );
  assert.equal(projectApprovals([pending], () => true, "pending").length, 1);
  assert.equal(
    projectApprovals([resolved], () => false, "granted")[0]?.resolutionNote,
    "Reviewed",
  );
  assert.deepEqual(
    projectApprovals([resolved], () => true, "pending"),
    [],
  );
  assert.deepEqual(projectApproval(pending, 0).offeredScopes, [
    "single_call",
    "always_user",
    "always_project",
  ]);
  assert.throws(() => projectApproval(pending, 1), /not found/);
});

test("questions preserve answers and dismissals without exposing non-actionable pending input", () => {
  const pending = call([question]);
  assert.deepEqual(
    projectQuestions([pending], () => false),
    [],
  );
  assert.equal(
    projectQuestions([pending], () => true, "pending")[0]?.question,
    "Proceed?",
  );
  const answered = call([
    {
      ...question,
      status: "resolved",
      resolution: { action: "answer", answer: "Yes" },
    },
  ]);
  assert.equal(
    projectQuestions([answered], () => false, "answered")[0]?.answer,
    "Yes",
  );
  const dismissed = call([
    {
      ...question,
      status: "resolved",
      resolution: { action: "dismiss", reason: "Not needed" },
    },
  ]);
  assert.equal(
    projectQuestions([dismissed], () => false, "dismissed")[0]?.dismissedReason,
    "Not needed",
  );
});
