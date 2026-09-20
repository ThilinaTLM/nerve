import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import { buildMobileInbox, type MobileInboxInput } from "./mobile-inbox.js";

function conversation(
  id: string,
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id,
    projectId: "proj_1",
    title: `Conversation ${id}`,
    mode: "code",
    permissionLevel: "standard",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ConversationRecord;
}

function input(overrides: Partial<MobileInboxInput> = {}): MobileInboxInput {
  return {
    approvals: [],
    userQuestions: [],
    planReviews: [],
    conversations: [],
    ...overrides,
  };
}

describe("buildMobileInbox", () => {
  it("lists pending approvals with tool context and project label", () => {
    const model = buildMobileInbox(
      input({
        conversations: [conversation("conv_a")],
        projectNameById: { proj_1: "nerve" },
        approvals: [
          {
            id: "approval_1",
            conversationId: "conv_a",
            projectId: "proj_1",
            risk: "command",
            reason: "Run the migration\nsecond line",
            status: "pending",
            requestedAt: "2026-01-02T00:00:00.000Z",
            toolCall: { toolName: "Bash" },
          } as never,
        ],
      }),
    );

    assert.equal(model.needsYou.length, 1);
    const [item] = model.needsYou;
    assert.equal(item?.kind, "approval");
    assert.equal(item?.title, "Conversation conv_a");
    assert.equal(item?.projectLabel, "nerve");
    assert.equal(item?.detail, "Bash · Run the migration");
    assert.equal(item?.kindLabel, "Approval");
    assert.equal(item?.tone, "warning");
  });

  it("tints destructive approvals red", () => {
    const model = buildMobileInbox(
      input({
        conversations: [conversation("conv_a")],
        approvals: [
          {
            id: "approval_1",
            conversationId: "conv_a",
            projectId: "proj_1",
            risk: "destructive",
            reason: "Delete the bucket",
            status: "pending",
            requestedAt: "2026-01-02T00:00:00.000Z",
          } as never,
        ],
      }),
    );
    assert.equal(model.needsYou[0]?.tone, "destructive");
  });

  it("ignores resolved interactions and orders newest first", () => {
    const model = buildMobileInbox(
      input({
        conversations: [conversation("conv_a"), conversation("conv_b")],
        userQuestions: [
          {
            id: "question_1",
            conversationId: "conv_a",
            projectId: "proj_1",
            question: "Which region?",
            status: "pending",
            requestedAt: "2026-01-01T00:00:00.000Z",
          } as never,
          {
            id: "question_2",
            conversationId: "conv_b",
            projectId: "proj_1",
            question: "Answered already",
            status: "answered",
            requestedAt: "2026-01-05T00:00:00.000Z",
          } as never,
        ],
        planReviews: [
          {
            id: "plan_review_1",
            conversationId: "conv_b",
            projectId: "proj_1",
            slug: "mobile-shell",
            status: "pending",
            requestedAt: "2026-01-03T00:00:00.000Z",
          } as never,
        ],
      }),
    );

    assert.deepEqual(
      model.needsYou.map((item) => item.id),
      ["plan:plan_review_1", "question:question_1"],
    );
    // A bare slug is rendered as prose rather than a filename.
    assert.equal(model.needsYou[0]?.detail, "Mobile shell");
  });

  it("separates running conversations and never duplicates a claimed one", () => {
    const model = buildMobileInbox(
      input({
        conversations: [conversation("conv_a"), conversation("conv_b")],
        approvals: [
          {
            id: "approval_1",
            conversationId: "conv_a",
            projectId: "proj_1",
            risk: "command",
            reason: "Run",
            status: "pending",
            requestedAt: "2026-01-02T00:00:00.000Z",
          } as never,
        ],
        activityById: {
          conv_a: {
            indicator: "running",
            tone: "info",
            label: "Agent running",
            busy: true,
          },
          conv_b: {
            indicator: "running",
            tone: "info",
            label: "Agent running",
            busy: true,
          },
        },
      }),
    );

    assert.deepEqual(
      model.needsYou.map((item) => item.conversationId),
      ["conv_a"],
    );
    assert.deepEqual(
      model.running.map((item) => item.conversationId),
      ["conv_b"],
    );
  });

  it("promotes errored conversations into the needs-you list", () => {
    const model = buildMobileInbox(
      input({
        conversations: [conversation("conv_a")],
        activityById: {
          conv_a: {
            indicator: "error",
            tone: "destructive",
            label: "Agent error",
            busy: false,
          },
        },
      }),
    );
    assert.equal(model.needsYou[0]?.kind, "error");
    assert.equal(model.needsYou[0]?.detail, "Agent error");
  });
});
