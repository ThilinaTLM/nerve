import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRecord, ProjectRecord } from "$lib/api";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
import {
  buildProjectSwitcherItems,
  projectActivityIndicator,
  quickProjectItems,
  summarizeProjectActivity,
} from "./project-switcher";

function project(
  id: string,
  name: string,
  dir: string,
  updatedAt: string,
): ProjectRecord {
  return { id, name, dir, updatedAt, createdAt: updatedAt } as ProjectRecord;
}

function conversation(
  id: string,
  projectId: string,
  updatedAt: string,
): ConversationRecord {
  return {
    id,
    projectId,
    title: id,
    updatedAt,
    createdAt: updatedAt,
    lastUserMessageAt: updatedAt,
  } as ConversationRecord;
}

function activity(
  input: Partial<ConversationActivityState>,
): ConversationActivityState {
  return {
    tone: "neutral",
    pulse: false,
    busy: false,
    needsUser: false,
    source: "none",
    ...input,
  };
}

test("summarizes only current actionable project activity", () => {
  const conversations = [
    conversation("error", "p", "2026-01-01"),
    conversation("waiting", "p", "2026-01-02"),
    conversation("running", "p", "2026-01-03"),
  ];
  assert.deepEqual(
    summarizeProjectActivity(conversations, {
      error: activity({ tone: "danger", busy: true }),
      waiting: activity({ tone: "warn", needsUser: true }),
      running: activity({ tone: "running", busy: true }),
    }),
    { needsUser: 1, running: 1 },
  );
});

test("omits project indicators for terminal errors", () => {
  const summary = summarizeProjectActivity(
    [conversation("error", "p", "2026-01-01")],
    { error: activity({ tone: "danger" }) },
  );
  assert.deepEqual(summary, { needsUser: 0, running: 0 });
  assert.equal(projectActivityIndicator(summary), undefined);
});

test("collapses actionable project activity into one indicator", () => {
  assert.equal(
    projectActivityIndicator({ needsUser: 0, running: 0 }),
    undefined,
  );
  assert.deepEqual(projectActivityIndicator({ needsUser: 1, running: 2 }), {
    tone: "warn",
    pulse: false,
    summary: "1 waiting for you, 2 running",
  });
  assert.deepEqual(projectActivityIndicator({ needsUser: 0, running: 1 }), {
    tone: "running",
    pulse: true,
    summary: "1 running",
  });
});

test("groups directory aliases and disambiguates duplicate folder names", () => {
  const projects = [
    project("p1", "app", "/work/one/app", "2026-01-01"),
    project("p2", "app alias", "/work/one/app/", "2026-01-02"),
    project("p3", "app", "/work/two/app", "2026-01-03"),
  ];
  const items = buildProjectSwitcherItems({
    projects,
    conversations: [conversation("c1", "p1", "2026-01-04")],
    activityById: {},
  });
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.find((item) => item.key === "/work/one/app")?.projectIds,
    ["p1", "p2"],
  );
  assert.ok(items.every((item) => item.label !== "app"));
});

test("sorts the chosen recent projects alphabetically", () => {
  const items = buildProjectSwitcherItems({
    projects: [
      project("z", "Zulu", "/zulu", "2026-01-03"),
      project("a", "Alpha", "/alpha", "2026-01-02"),
      project("m", "Mike", "/mike", "2026-01-01"),
    ],
    conversations: [],
    activityById: {},
  });
  assert.deepEqual(
    quickProjectItems(items, undefined, 2).map((item) => item.label),
    ["alpha", "zulu"],
  );
});

test("quick projects always retain the active project", () => {
  const items = buildProjectSwitcherItems({
    projects: [
      project("a", "a", "/a", "2026-01-01"),
      project("b", "b", "/b", "2026-01-02"),
      project("c", "c", "/c", "2026-01-03"),
    ],
    conversations: [],
    activityById: {},
  });
  assert.deepEqual(
    quickProjectItems(items, "/a", 1).map((item) => item.key),
    ["/a"],
  );
  assert.deepEqual(
    quickProjectItems(items, "/a", 2).map((item) => item.key),
    ["/a", "/c"],
  );
});
