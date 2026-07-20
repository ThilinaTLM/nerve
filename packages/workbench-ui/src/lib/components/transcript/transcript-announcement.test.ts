import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  transcriptAnnouncementForTransition,
  type TranscriptAnnouncementState,
} from "./transcript-announcement";

const idle: TranscriptAnnouncementState = {
  active: true,
  sending: false,
  pendingQuestionIds: [],
  pendingPlanReviewIds: [],
};

describe("transcript announcements", () => {
  it("announces multiple pending questions and ignores ordering-only changes", () => {
    const pending = {
      ...idle,
      pendingQuestionIds: ["question_1", "question_2"],
    };
    assert.equal(
      transcriptAnnouncementForTransition(idle, pending),
      "2 answers required.",
    );
    assert.equal(
      transcriptAnnouncementForTransition(pending, {
        ...pending,
        pendingQuestionIds: ["question_2", "question_1"],
      }),
      undefined,
    );
  });

  it("announces the remaining question when one resolves", () => {
    assert.equal(
      transcriptAnnouncementForTransition(
        { ...idle, pendingQuestionIds: ["question_1", "question_2"] },
        { ...idle, pendingQuestionIds: ["question_1"] },
      ),
      "Nerve is waiting for your answer.",
    );
  });

  it("announces multiple plan reviews and ignores no-op rerenders", () => {
    const pending = {
      ...idle,
      pendingPlanReviewIds: ["plan_review_1", "plan_review_2"],
    };
    assert.equal(
      transcriptAnnouncementForTransition(idle, pending),
      "2 plans are ready for review.",
    );
    assert.equal(
      transcriptAnnouncementForTransition(pending, { ...pending }),
      undefined,
    );
  });
});
