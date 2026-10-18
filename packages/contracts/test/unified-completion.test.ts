import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completionSearchRequestSchema,
  completionSelectionRequestSchema,
  parseCompletionIntent,
} from "../src/domains/completions/unified-completion.js";

void test("typed intent parsing narrows all supported sources without lexical matching", () => {
  assert.deepEqual(parseCompletionIntent("@file:src/sess"), {
    text: "src/sess",
    kinds: ["file", "directory"],
  });
  assert.deepEqual(parseCompletionIntent("@agent:review"), {
    text: "review",
    kinds: ["subagent_profile", "subagent"],
  });
  assert.deepEqual(parseCompletionIntent("@launch:dev"), {
    text: "dev",
    kinds: ["launch", "launch_definition"],
  });
  for (const prefix of ["pr", "issue", "skill", "tool", "profile"])
    assert.ok(parseCompletionIntent(`@${prefix}:name`).kinds);
  assert.deepEqual(parseCompletionIntent("@unknown:path"), {
    text: "unknown:path",
  });
});

void test("search accepts scope, not client authorization/context overrides; selection needs version/action", () => {
  assert.equal(
    completionSearchRequestSchema.parse({ projectId: "p" }).limit,
    8,
  );
  assert.equal(
    completionSearchRequestSchema.safeParse({ projectId: "p", limit: 64 })
      .success,
    false,
  );
  assert.equal(
    completionSearchRequestSchema.safeParse({
      projectId: "p",
      context: { permitted: true },
    }).success,
    false,
  );
  assert.equal(
    completionSearchRequestSchema.safeParse({
      projectId: "p",
      documentIds: ["foreign-seed"],
    }).success,
    false,
    "native identity filters are server-derived, not client authorization",
  );
  assert.equal(
    completionSelectionRequestSchema.safeParse({
      projectId: "p",
      documentId: "skill",
      action: "select",
    }).success,
    false,
  );
  assert.equal(
    completionSelectionRequestSchema.safeParse({
      projectId: "p",
      documentId: "skill",
      expectedVersion: "v1",
      action: "trust",
    }).success,
    false,
  );
  assert.equal(
    completionSelectionRequestSchema.safeParse({
      projectId: "p",
      documentId: "skill",
      expectedVersion: "v1",
      action: "disable",
    }).success,
    true,
  );
});
