import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import { summaryActivity } from "$lib/presentation/conversations/conversation-activity";
import {
  projectActivity,
  quickProjectItems,
  type ProjectSwitcherItem,
} from "./project-switcher.js";

const row = (
  id: string,
  status: ConversationSummary["status"],
  extra: Partial<ConversationSummary> = {},
) =>
  ({
    id,
    status,
    pendingWork: false,
    pendingInput: null,
    ...extra,
  }) as ConversationSummary;

test("a question outranks running and finished conversations", () => {
  const rows = [
    row("a", "running"),
    row("b", "idle"),
    row("c", "waiting"),
    row("d", "failed"),
  ];
  const activityById = {
    a: summaryActivity(rows[0]),
    b: summaryActivity(rows[1], { resultReady: true }),
    c: summaryActivity(rows[2]),
    d: summaryActivity(rows[3]),
  };
  assert.equal(projectActivity(rows, activityById).indicator, "needs-user");
  assert.equal(
    projectActivity([rows[0], rows[1], rows[3]], activityById).indicator,
    "error",
  );
  assert.equal(
    projectActivity([rows[0], rows[1]], activityById).indicator,
    "running",
  );
  assert.equal(
    projectActivity([rows[1]], activityById).indicator,
    "result-ready",
  );
});

test("completed conversations leave a project quiet", () => {
  const rows = [row("a", "idle", { completedAt: "2026-01-01T00:00:00Z" })];
  assert.equal(
    projectActivity(rows, { a: summaryActivity(rows[0]) }).indicator,
    "idle",
  );
});

test("the header promotes stale projects that need the user", () => {
  const item = (key: string, indicator: "idle" | "needs-user" = "idle") =>
    ({
      key,
      label: key,
      activity: { indicator },
    }) as ProjectSwitcherItem;
  const items = [item("c"), item("a"), item("d"), item("b", "needs-user")];
  assert.deepEqual(
    quickProjectItems(items, "c", 2).map((entry) => entry.key),
    ["a", "b", "c"],
  );
});
