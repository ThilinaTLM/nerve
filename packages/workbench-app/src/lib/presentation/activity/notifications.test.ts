import assert from "node:assert/strict";
import test from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import { buildNotifications } from "./notifications.js";

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
