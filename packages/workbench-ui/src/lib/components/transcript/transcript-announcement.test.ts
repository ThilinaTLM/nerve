import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  transcriptAnnouncementForTransition,
  type TranscriptAnnouncementState,
} from "./transcript-announcement";

const idle: TranscriptAnnouncementState = { active: true, sending: false };

describe("transcript announcements", () => {
  it("does not announce initial or inactive state", () => {
    assert.equal(
      transcriptAnnouncementForTransition(undefined, idle),
      undefined,
    );
    assert.equal(
      transcriptAnnouncementForTransition(
        { active: false, sending: false },
        { active: true, sending: true },
      ),
      undefined,
    );
    assert.equal(
      transcriptAnnouncementForTransition(idle, {
        active: false,
        sending: true,
      }),
      undefined,
    );
  });

  it("announces response start and completion once", () => {
    const responding = { active: true, sending: true };
    assert.equal(
      transcriptAnnouncementForTransition(idle, responding),
      "Nerve is responding.",
    );
    assert.equal(
      transcriptAnnouncementForTransition(responding, responding),
      undefined,
    );
    assert.equal(
      transcriptAnnouncementForTransition(responding, idle),
      "Response complete.",
    );
  });

  it("announces each newly blocking human interaction once", () => {
    const approval = { ...idle, pendingApprovalId: "approval_1" };
    assert.equal(
      transcriptAnnouncementForTransition(idle, approval),
      "Approval required.",
    );
    assert.equal(
      transcriptAnnouncementForTransition(approval, approval),
      undefined,
    );

    const question = { ...idle, pendingQuestionId: "question_1" };
    assert.equal(
      transcriptAnnouncementForTransition(idle, question),
      "Nerve is waiting for your answer.",
    );

    const plan = { ...idle, pendingPlanReviewId: "plan_review_1" };
    assert.equal(
      transcriptAnnouncementForTransition(idle, plan),
      "A plan is ready for review.",
    );
  });
});
