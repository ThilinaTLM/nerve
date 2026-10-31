import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_TITLE_IMAGE_MARKER,
  conversationTitleToPlainText,
} from "@nervekit/contracts/core";
import { idleConversationActivity } from "./conversation-activity";
import {
  searchConversations,
  conversationTitleRuns,
  conversationTitleDisplaySegments,
} from "./conversation-search";

function row(id: string, title: string, extra = {}) {
  return {
    conversation: {
      id,
      title,
      pinned: false,
      createdAt: "2026-10-31T10:00:00Z",
      lastUserMessageAt: null,
      completedAt: null as string | null,
      ...extra,
    },
  };
}

test("title substring ranks word starts first and every term must match", () => {
  const rows = [
    row("substring", "redashboard"),
    row("start", "Dashboard settings"),
  ];
  assert.deepEqual(
    searchConversations(rows, "dash").map((hit) => hit.row.conversation.id),
    ["start", "substring"],
  );
  assert.equal(searchConversations(rows, "dash settings").length, 1);
  assert.equal(searchConversations(rows, "dash missing").length, 0);
  assert.equal(searchConversations(rows, "  ").length, 0);
});

test("lazy matching prefers word starts and consecutive runs, drops scattered noise", () => {
  const hit = searchConversations(
    [row("ws", "websocket reconnect backoff")],
    "wsback",
  )[0];
  assert.ok(hit);
  assert.equal(
    hit.titleIndexes.map((index) => hit.row.conversation.title[index]).join(""),
    "wsback",
  );
  assert.equal(
    searchConversations([row("noise", "a.............b.............c")], "abc")
      .length,
    0,
  );
});

test("status prefixes outrank titles, done rows and pins are searchable", () => {
  const rows = [
    row("title", "Failed tests"),
    row("failed", "Fix tests"),
    row("done", "Old chat", { completedAt: "done" }),
    row("pin", "Keep", { pinned: true }),
  ];
  const options = {
    activityById: {
      failed: { ...idleConversationActivity, indicator: "error" as const },
    },
  };
  assert.deepEqual(
    searchConversations(rows, "fail", options).map(
      (hit) => hit.row.conversation.id,
    ),
    ["failed", "title"],
  );
  assert.equal(
    searchConversations(rows, "error", options)[0]?.row.conversation.id,
    "failed",
  );
  assert.equal(
    searchConversations(rows, "attention", options)[0]?.row.conversation.id,
    "failed",
  );
  assert.equal(
    searchConversations(rows, "done")[0]?.row.conversation.id,
    "done",
  );
  assert.equal(
    searchConversations(rows, "pinn")[0]?.row.conversation.id,
    "pin",
  );
});

test("ties use prompt recency; full input is searched beyond the display cap", () => {
  const rows = Array.from({ length: 110 }, (_, i) =>
    row(String(i), "Task", {
      lastUserMessageAt: i === 109 ? "2026-10-31T11:00:00Z" : null,
    }),
  );
  assert.equal(searchConversations(rows, "task").length, 110);
  assert.equal(
    searchConversations(rows, "task")[0]?.row.conversation.id,
    "109",
  );
});

test("additional field candidates participate in ranking and the relative cut-off", () => {
  const rows = [row("exact", "Other"), row("lazy", "axbc")];
  const hits = searchConversations(rows, "abc", {
    matchField: (row) =>
      row.conversation.id === "exact"
        ? { score: 100, referenceKey: "future-reference" }
        : undefined,
  });
  assert.deepEqual(
    hits.map((hit) => hit.row.conversation.id),
    ["exact"],
  );
  assert.equal(hits[0]?.referenceKey, "future-reference");
});

test("title marks merge adjacent characters into runs", () => {
  assert.deepEqual(conversationTitleRuns("Dashboard", [0, 1, 4]), [
    { text: "Da", hit: true },
    { text: "sh", hit: false },
    { text: "b", hit: true },
    { text: "oard", hit: false },
  ]);
});

test("image aliases match semantic markers but raw marker code points never match titles", () => {
  const rows = [
    row("image", `Check ${CONVERSATION_TITLE_IMAGE_MARKER} layout`),
    row("text", "Check layout"),
  ];
  for (const query of [
    "image",
    "screenshot",
    "image layout",
    "screenshot layout",
  ]) {
    assert.deepEqual(
      searchConversations(rows, query).map((hit) => hit.row.conversation.id),
      ["image"],
    );
  }
  assert.equal(
    searchConversations(rows, CONVERSATION_TITLE_IMAGE_MARKER).length,
    0,
  );
  assert.equal(
    searchConversations(rows, `${CONVERSATION_TITLE_IMAGE_MARKER} layout`)
      .length,
    0,
  );
  assert.equal(
    searchConversations([row("manual", "Screenshot layout")], "screenshot")
      .length,
    1,
  );
});

test("highlight indexes use the plain fallback and map to text on either side of image icons", () => {
  const title = `📷 Check ${CONVERSATION_TITLE_IMAGE_MARKER} backoff ${CONVERSATION_TITLE_IMAGE_MARKER} dashboard`;
  const hit = searchConversations([row("image", title)], "check back dash")[0];
  assert.ok(hit);
  const plain = conversationTitleToPlainText(title);
  assert.equal(
    hit.titleIndexes.map((index) => plain[index]).join(""),
    "Checkbackdash",
  );
  const segments = conversationTitleDisplaySegments(title, hit.titleIndexes);
  assert.equal(
    segments.filter((segment) => segment.type === "image").length,
    2,
  );
  const textRuns = segments.flatMap((segment) =>
    segment.type === "text" ? segment.runs : [],
  );
  assert.equal(
    textRuns
      .filter((run) => run.hit)
      .map((run) => run.text)
      .join(""),
    "Checkbackdash",
  );
  assert.equal(
    textRuns.map((run) => run.text).join(""),
    "📷 Check  backoff  dashboard",
  );
  assert.equal(
    textRuns.some(
      (run) =>
        run.text.includes(CONVERSATION_TITLE_IMAGE_MARKER) ||
        run.text.includes("(image)"),
    ),
    false,
  );
});

test("synthetic fallback matches never shift highlights into neighbouring text", () => {
  const title = `${CONVERSATION_TITLE_IMAGE_MARKER} backoff`;
  const hit = searchConversations([row("image", title)], "mage back")[0];
  assert.ok(hit);
  assert.deepEqual(conversationTitleDisplaySegments(title, hit.titleIndexes), [
    { type: "image" },
    {
      type: "text",
      runs: [
        { text: " ", hit: false },
        { text: "back", hit: true },
        { text: "off", hit: false },
      ],
    },
  ]);
  assert.deepEqual(conversationTitleDisplaySegments(title, []), [
    { type: "image" },
    { type: "text", runs: [{ text: " backoff", hit: false }] },
  ]);
});
