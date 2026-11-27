import assert from "node:assert/strict";
import test from "node:test";
import { blockedReviewTargets } from "./blocked-review";

const diagnostic = (patch: {
  scope: "user" | "project";
  path: string;
  code?: string;
}) => ({
  document: patch.path.split("/").pop()!,
  pointer: "",
  code: patch.code ?? "needs-review",
  affectedCapability: "tool-execution",
  recoveryChoices: ["retry" as const],
  ...patch,
});

test("a call blocked by a pending permission file reviews that file", () => {
  assert.deepEqual(
    blockedReviewTargets(
      [
        diagnostic({ scope: "user", path: "/h/config/rule-sets/careful.json" }),
        diagnostic({ scope: "user", path: "/h/config/permissions.json" }),
        diagnostic({
          scope: "project",
          path: "/p/.nerve/config/permissions.json",
        }),
      ],
      "p1",
    ),
    [
      { kind: "rule-set", scope: "user", id: "careful" },
      { kind: "permission-overlay", scope: "user", id: "permissions.json" },
      {
        kind: "permission-overlay",
        scope: "project",
        projectId: "p1",
        id: "permissions.json",
      },
    ],
  );
});

test("broken files and project files without a project have nothing to review", () => {
  assert.deepEqual(
    blockedReviewTargets(
      [
        diagnostic({
          scope: "user",
          path: "/h/config/permissions.json",
          code: "invalid-policy",
        }),
        diagnostic({
          scope: "project",
          path: "/p/.nerve/config/permissions.json",
        }),
      ],
      undefined,
    ),
    [],
  );
});
