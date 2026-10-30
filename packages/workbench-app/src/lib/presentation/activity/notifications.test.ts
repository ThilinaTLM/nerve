import assert from "node:assert/strict";
import test from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import {
  buildNotifications,
  groupUnreadableConversations,
  notificationRank,
  type NotificationItem,
} from "./notifications.js";

const iso = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60_000).toISOString();
function activity(id: string, patch: Partial<Activity> = {}): Activity {
  return {
    id,
    revision: 1,
    kind: "git.fetch",
    title: id,
    status: "succeeded",
    startedAt: iso(10),
    updatedAt: iso(5),
    finishedAt: iso(5),
    actions: { cancel: false, retry: false },
    ...patch,
  };
}
const base = { needsYou: [], readIds: new Set<string>() };

test("orders needs-you, running, then finished, newest first", () => {
  const items = buildNotifications({
    ...base,
    activities: [
      activity("old-done", { finishedAt: iso(20) }),
      activity("new-done", { finishedAt: iso(2) }),
      activity("run", {
        status: "running",
        finishedAt: undefined,
        actions: { cancel: true, retry: false },
      }),
    ],
    needsYou: [
      {
        id: "c1",
        kind: "attention",
        title: "Approval needed",
        conversationId: "c1",
        conversationTitle: "Fix tests",
        at: iso(30),
      },
    ],
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["attention:c1", "run", "new-done", "old-done"],
  );
  assert.equal(items[1]?.action?.intent, "cancel");
});

test("children fold into their parent with derived progress", () => {
  const items = buildNotifications({
    ...base,
    activities: [
      activity("parent", { status: "running", finishedAt: undefined }),
      activity("a", { parentId: "parent" }),
      activity("b", { parentId: "parent", status: "running" }),
    ],
  });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0]?.progress, { completed: 1, total: 2 });
  assert.deepEqual(
    items[0]?.children.map((child) => child.status),
    ["done", "running"],
  );
});

test("omits the active project and tracks unread", () => {
  const items = buildNotifications({
    ...base,
    activeProjectId: "p1",
    readIds: new Set(["seen"]),
    activities: [
      activity("seen", {
        scope: {
          projectId: "p1",
          projectName: "Atlas",
          repositoryPath: "/a/api",
        },
      }),
      activity("fresh", {
        status: "failed",
        error: { message: "denied" },
        actions: { cancel: false, retry: true },
        scope: {
          projectId: "p2",
          projectName: "Beta",
          repositoryPath: "/b/web",
        },
      }),
    ],
  });
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.equal(byId.seen?.context, "api");
  assert.equal(byId.seen?.unread, false);
  assert.equal(byId.fresh?.context, "Beta · web");
  assert.equal(byId.fresh?.unread, true);
  assert.equal(byId.fresh?.detail, "denied");
  assert.equal(byId.fresh?.action?.intent, "retry");
});

test("conversation items: failures need attention, finished results do not", () => {
  const items = buildNotifications({
    ...base,
    activities: [activity("done")],
    needsYou: [
      {
        id: "f",
        kind: "finished",
        title: "Agent finished",
        conversationId: "f",
        conversationTitle: "Ship it",
        at: iso(1),
      },
      {
        id: "x",
        kind: "failed",
        title: "Agent failed",
        conversationId: "x",
        conversationTitle: "Broken",
        at: iso(40),
      },
    ],
  });
  assert.deepEqual(
    items.map((item) => [item.id, item.kind, notificationRank(item)]),
    [
      ["failed:x", "failed", 0],
      ["finished:f", "succeeded", 2],
      ["done", "succeeded", 2],
    ],
  );
  assert.equal(items[0]?.title, "Agent failed");
  assert.equal(items[1]?.conversationId, "f");
});

test("unreadable conversations stay in one non-dismissible attention item with deletion metadata", () => {
  const unreadableConversations = [
    {
      id: "bad",
      title: "Raw",
      projectId: "p",
      projectName: "Project",
      error: "invalid status",
    },
  ];
  const [item] = buildNotifications({
    ...base,
    activities: [
      activity("unreadable", {
        status: "failed",
        kind: "conversation.unreadable",
        unreadableConversations,
      }),
    ],
  });
  assert.equal(notificationRank(item), 0);
  assert.deepEqual(item.unreadableConversations, unreadableConversations);
  assert.equal(item.conversationId, undefined);
  assert.equal(item.action, undefined);
});

test("unreadable conversations summarize projects and show a shared error once", () => {
  const entry = (id: string, projectId: string, error = "bad payload") => ({
    id,
    title: id,
    projectId,
    projectName: projectId.toUpperCase(),
    error,
  });
  const build = (
    unreadableConversations: ReturnType<typeof entry>[],
  ): NotificationItem =>
    buildNotifications({
      ...base,
      activities: [
        activity("unreadable", {
          status: "failed",
          kind: "conversation.unreadable",
          unreadableConversations,
        }),
      ],
    })[0];
  const shared = build([
    entry("a", "p"),
    entry("b", "q"),
    entry("c", "p"),
    entry("d", "r"),
  ]);
  assert.equal(shared.context, "P, Q +1 more");
  assert.equal(shared.detail, "bad payload");
  assert.deepEqual(
    groupUnreadableConversations(shared.unreadableConversations!).groups.map(
      (group) => [group.projectName, group.entries.map((e) => e.id)],
    ),
    [
      ["P", ["a", "c"]],
      ["Q", ["b"]],
      ["R", ["d"]],
    ],
  );
  assert.equal(
    build([entry("a", "p"), entry("b", "p", "other")]).detail,
    undefined,
  );
});
