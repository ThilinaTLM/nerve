import assert from "node:assert/strict";
import test from "node:test";
import {
  idleConversationActivity,
  type ConversationActivity,
} from "./conversation-activity";
import {
  buildConversationSections,
  limitConversationSections,
  type ConversationListRow,
} from "./conversation-list";

const now = new Date(2026, 9, 31, 12);
function row(id: string, days = 0, extra = {}): ConversationListRow {
  return {
    conversation: {
      id,
      title: id,
      pinned: false,
      createdAt: new Date(2026, 9, 31 - days, 10).toISOString(),
      lastUserMessageAt: null,
      completedAt: null,
      ...extra,
    },
  };
}
function activity(
  indicator: ConversationActivity["indicator"],
): ConversationActivity {
  return { ...idleConversationActivity, indicator };
}

test("sections are exclusive, prioritize pinned and attention, and leave running in date buckets", () => {
  const rows = [
    row("running"),
    row("finished"),
    row("failed"),
    row("question", 1),
    row("pinned", 3, { pinned: true }),
    row("yesterday", 1),
    row("week", 7),
    row("old", 8),
  ];
  const sections = buildConversationSections({
    rows,
    now,
    activityById: {
      running: activity("running"),
      finished: activity("result-ready"),
      failed: activity("error"),
      question: activity("needs-user"),
      pinned: activity("needs-user"),
    },
  });
  assert.deepEqual(
    sections.map((section) => [
      section.label,
      section.rows.map((row) => row.conversation.id),
    ]),
    [
      ["Pinned", ["pinned"]],
      ["Needs you", ["question", "failed"]],
      ["Today", ["finished", "running"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ],
  );
  assert.equal(
    new Set(sections.flatMap((section) => section.rows)).size,
    rows.length,
  );
});

test("completed pending input stays visible; finished results keep their day section", () => {
  const rows = [
    row("done", 0, { completedAt: "done" }),
    row("pending", 0, { completedAt: "done" }),
    row("finished", 1),
  ];
  const sections = buildConversationSections({
    rows,
    now,
    hideCompleted: true,
    activityById: {
      pending: activity("needs-user"),
      finished: activity("result-ready"),
    },
  });
  assert.deepEqual(
    sections.map((section) => [
      section.key,
      section.rows.map((row) => row.conversation.id),
    ]),
    [
      ["needs-you", ["pending"]],
      ["yesterday", ["finished"]],
    ],
  );
});

test("recency uses user prompt with creation fallback, never title or activity metadata", () => {
  const a = row("a", 0, {
    title: "Z",
    lastUserMessageAt: new Date(2026, 9, 30, 9).toISOString(),
  });
  const b = row("b", 1, { title: "A" });
  const c = row("c", 1, { title: "Z" });
  const ids = () =>
    buildConversationSections({ rows: [a, c, b], now }).flatMap((section) =>
      section.rows.map((row) => row.conversation.id),
    );
  assert.deepEqual(ids(), ["b", "c", "a"]);
  b.conversation.title = "ZZZ";
  c.conversation.title = "AAA";
  assert.deepEqual(ids(), ["b", "c", "a"]);
});

test("cap is display only and does not mutate sections", () => {
  const sections = buildConversationSections({
    rows: Array.from({ length: 110 }, (_, i) => row(String(i))),
    now,
  });
  assert.equal(limitConversationSections(sections, 100)[0]?.rows.length, 100);
  assert.equal(sections[0]?.rows.length, 110);
});
