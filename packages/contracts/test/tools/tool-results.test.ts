import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askUserResultSchema,
  editOperationResultDetailsSchema,
  subagentStatusResultDetailsSchema,
} from "../../src/domains/tools/tool-results.js";

void test("ask_user results retain per-question structured answers and skips", () => {
  const result = {
    questions: [
      {
        id: "q1",
        question: "Which?",
        answer: { option: "One", text: "because" },
      },
      { id: "q2", question: "Why?", skipped: true },
    ],
    dismissed: true,
  };
  assert.deepEqual(askUserResultSchema.parse(result), result);
  assert.equal(
    askUserResultSchema.safeParse({
      questions: [{ id: "q", question: "?", answer: "wrong" }],
    }).success,
    false,
  );
});

void test("subagent status details constrain state, context percentage and timestamp", () => {
  const agent = {
    name: "a",
    state: "running",
    contextPercent: 100,
    lastActivityAt: "2026-10-17T12:00:00.000Z",
  };
  assert.deepEqual(
    subagentStatusResultDetailsSchema.parse({ agents: [agent] }),
    { agents: [agent] },
  );
  for (const fields of [
    { contextPercent: 101 },
    { contextPercent: -1 },
    { state: "invented" },
    { lastActivityAt: "yesterday" },
  ]) {
    assert.equal(
      subagentStatusResultDetailsSchema.safeParse({
        agents: [{ ...agent, ...fields }],
      }).success,
      false,
    );
  }
});

void test("atomic edit failure details parse without success-only diff metadata", () => {
  const details = {
    operationCount: 2,
    appliedCount: 0,
    operations: [
      { index: 0, type: "replace_text", status: "not_applied" },
      { index: 1, type: "replace_text", status: "failed", error: "not found" },
    ],
  };
  assert.deepEqual(editOperationResultDetailsSchema.parse(details), details);
});
