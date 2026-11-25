import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalOutcome,
  formatBytes,
  skillApprovalProblem,
  skillFilePath,
  skillReviewCaption,
} from "./skill-review";

test("status lines and captions name the approval state", () => {
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
  assert.match(
    skillReviewCaption({
      trustState: "needs_review",
      changedSinceDecision: true,
    }),
    /trust it again/,
  );
  assert.match(
    skillReviewCaption({ trustState: "declined", changedSinceDecision: true }),
    /changed since you declined/,
  );
  assert.match(
    skillReviewCaption({ trustState: "trusted", changedSinceDecision: false }),
    /trusted$/,
  );
});

test("approval names the digest the user saw; changed files reload the review", () => {
  assert.equal(
    approvalOutcome(
      { contentDigest: "sha256:a" },
      { contentDigest: "sha256:a" },
    ),
    "approve",
  );
  assert.equal(
    approvalOutcome(
      { contentDigest: "sha256:a" },
      { contentDigest: "sha256:b" },
    ),
    "reload",
  );
});

test("file paths join the skill folder; sizes are short", () => {
  assert.equal(
    skillFilePath("/p/.nerve/skills/x/", "scripts/a.sh"),
    "/p/.nerve/skills/x/scripts/a.sh",
  );
  assert.equal(
    skillFilePath("C:\\p\\skills\\x", "a.sh"),
    "C:\\p\\skills\\x\\a.sh",
  );
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1843), "1.8 KB");
});
