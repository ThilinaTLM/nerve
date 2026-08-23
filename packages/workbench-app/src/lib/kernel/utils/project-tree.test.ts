import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRecord } from "@nervekit/contracts";
import {
  buildConversationSections,
  limitConversationSections,
} from "./project-tree";

const projectId = "proj_01HN0000000000000000000000";

function atLocal(daysAgo: number, hour = 12): string {
  const date = new Date(2026, 7, 23, hour);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function conversation(
  suffix: string,
  updatedAt: string,
  state: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id: `conv_01HN00000000000000000000${suffix}`,
    projectId,
    title: `Conversation ${suffix}`,
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: { autoApproveReadOnly: true },
    createdAt: updatedAt,
    updatedAt,
    ...state,
  } as ConversationRecord;
}

describe("conversation list grouping", () => {
  it("puts pinned conversations first and groups the rest by local activity date", () => {
    const sections = buildConversationSections({
      projectIds: [projectId],
      agents: [],
      now: new Date(2026, 7, 23, 18),
      conversations: [
        conversation("01", atLocal(0, 8)),
        conversation("02", atLocal(0, 16)),
        conversation("03", atLocal(1)),
        conversation("04", atLocal(4), {
          completedAt: atLocal(2),
        }),
        conversation("05", atLocal(8)),
        conversation("06", atLocal(3), { pinned: true }),
        conversation("07", atLocal(0, 10), { pinned: true }),
      ],
    });

    assert.deepEqual(
      sections.map((section) => section.label),
      ["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"],
    );
    assert.deepEqual(
      sections[0]?.rows.map((row) => row.conversation.id.slice(-2)),
      ["07", "06"],
    );
    assert.deepEqual(
      sections[1]?.rows.map((row) => row.conversation.id.slice(-2)),
      ["02", "01"],
    );
    assert.equal(sections[3]?.rows[0]?.conversation.completedAt, atLocal(2));
    assert.equal(
      sections.flatMap((section) => section.rows).length,
      7,
      "pinned rows must not be duplicated in date sections",
    );
  });

  it("moves completed conversations below unfinished ones within each section", () => {
    const sections = buildConversationSections({
      projectIds: [projectId],
      agents: [],
      now: new Date(2026, 7, 23, 18),
      conversations: [
        conversation("01", atLocal(0, 16), { completedAt: atLocal(0, 17) }),
        conversation("02", atLocal(0, 8)),
        conversation("03", atLocal(0, 12), { completedAt: atLocal(0, 13) }),
        conversation("04", atLocal(0, 7)),
      ],
    });

    assert.deepEqual(
      sections[0]?.rows.map((row) => row.conversation.id.slice(-2)),
      ["02", "04", "01", "03"],
    );
  });

  it("hides completed conversations only when requested", () => {
    const conversations = [
      conversation("01", atLocal(0), { completedAt: atLocal(0) }),
      conversation("02", atLocal(0)),
      conversation("03", atLocal(1), {
        completedAt: atLocal(1),
        pinned: true,
      }),
    ];
    const visibleByDefault = buildConversationSections({
      projectIds: [projectId],
      agents: [],
      now: new Date(2026, 7, 23, 18),
      conversations,
    });
    assert.equal(visibleByDefault.flatMap((section) => section.rows).length, 3);

    const hidden = buildConversationSections({
      projectIds: [projectId],
      agents: [],
      now: new Date(2026, 7, 23, 18),
      conversations,
      hideCompleted: true,
    });
    assert.deepEqual(
      hidden.flatMap((section) =>
        section.rows.map((row) => row.conversation.id.slice(-2)),
      ),
      ["02"],
    );
  });

  it("filters before grouping and limits conversation rows rather than headers", () => {
    const sections = buildConversationSections({
      projectIds: [projectId],
      agents: [],
      now: new Date(2026, 7, 23, 18),
      filter: "keep",
      conversations: [
        conversation("01", atLocal(0), { title: "Keep today" }),
        conversation("02", atLocal(1), { title: "Keep yesterday" }),
        conversation("03", atLocal(0), { title: "Discard" }),
      ],
    });
    const limited = limitConversationSections(sections, 1);
    assert.equal(limited.length, 1);
    assert.equal(limited[0]?.rows.length, 1);
    assert.equal(limited[0]?.rows[0]?.conversation.title, "Keep today");
  });
});
