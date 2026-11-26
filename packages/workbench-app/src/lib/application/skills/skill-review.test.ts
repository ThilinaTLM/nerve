import assert from "node:assert/strict";
import test from "node:test";
import { skillApprovalProblem } from "./skill-review";

test("status lines name the approval state", () => {
  assert.equal(
    skillApprovalProblem({ trustState: "needs_review" }),
    "Waiting for your review",
  );
  assert.equal(
    skillApprovalProblem({
      trustState: "needs_review",
      changedSinceDecision: true,
    }),
    "Changed since you trusted it",
  );
  // A decline is the user's choice: no problem line asks again.
  assert.equal(
    skillApprovalProblem({
      trustState: "declined",
      changedSinceDecision: true,
    }),
    undefined,
  );
  assert.equal(skillApprovalProblem({}), undefined);
});
