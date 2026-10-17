import assert from "node:assert/strict";
import { test } from "node:test";
import {
  interactionSchema,
  normalizeUserInputRequest,
  userInputRequestSchema,
} from "../../src/domains/core/tool-call.js";

test("normalizes canonical, model-generated, and legacy user-input requests", () => {
  const request = {
    questions: [
      {
        id: "target",
        question: "Where?",
        options: [{ label: "Here", recommended: true }],
      },
    ],
  };
  assert.deepEqual(normalizeUserInputRequest(request), request);
  assert.deepEqual(
    normalizeUserInputRequest({
      questions: [{ question: "One?" }, { question: "Two?" }],
    }),
    {
      questions: [
        { id: "q1", question: "One?" },
        { id: "q2", question: "Two?" },
      ],
    },
  );
  const legacy = {
    question: "Continue?",
    context: "A change",
    recommendation: "Yes",
  };
  const normalized = { questions: [{ ...legacy, id: "answer" }] };
  assert.deepEqual(normalizeUserInputRequest(legacy), normalized);
  assert.deepEqual(
    interactionSchema.parse({ kind: "user_input", request: legacy }).request,
    normalized,
  );
});

test("rejects invalid user-input requests", () => {
  const question = { id: "q1", question: "Which?" };
  for (const value of [
    { questions: [] },
    {
      questions: Array.from({ length: 6 }, (_, i) => ({
        ...question,
        id: `q${i}`,
      })),
    },
    { questions: [question, question] },
    { questions: [{ ...question, id: "bad id" }] },
    {
      questions: [
        {
          ...question,
          options: Array.from({ length: 7 }, (_, i) => ({ label: String(i) })),
        },
      ],
    },
    { questions: [{ ...question, options: [{ label: "A" }, { label: "A" }] }] },
    {
      questions: [
        {
          ...question,
          options: [
            { label: "A", recommended: true },
            { label: "B", recommended: true },
          ],
        },
      ],
    },
    { questions: [{ ...question, options: [{ label: "" }] }] },
  ]) {
    assert.equal(userInputRequestSchema.safeParse(value).success, false);
    assert.throws(() => normalizeUserInputRequest(value));
  }
});
