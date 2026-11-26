import assert from "node:assert/strict";
import test from "node:test";
import { reviewTargetPage } from "./review-target-page";

test("Details opens the item's own page in its scope", () => {
  assert.deepEqual(
    reviewTargetPage(
      { kind: "agent-profile", scope: "user", id: "reviewer" },
      () => "sub-agents",
    ),
    { scope: "user", pageId: "sub-agents", item: "user:reviewer" },
  );
  assert.deepEqual(
    reviewTargetPage({
      kind: "skill",
      scope: "project",
      projectId: "p1",
      id: "release-notes",
    }),
    {
      scope: "project",
      projectId: "p1",
      pageId: "skills",
      item: "project:release-notes",
    },
  );
  assert.deepEqual(
    reviewTargetPage({
      kind: "prompt-suggestion",
      scope: "user",
      id: "triage",
    }),
    { scope: "user", pageId: "suggestions", item: "user:triage" },
  );
  assert.deepEqual(
    reviewTargetPage({
      kind: "permission-overlay",
      scope: "user",
      id: "permissions.json",
    }),
    { scope: "user", pageId: "permission-rules" },
  );
  assert.deepEqual(
    reviewTargetPage({ kind: "rule-set", scope: "user", id: "careful" }),
    { scope: "user", pageId: "permission-rules", item: "careful" },
  );
});
