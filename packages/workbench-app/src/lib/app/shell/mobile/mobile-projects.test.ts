import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupMobileProjects,
  projectCounts,
  projectCountsLine,
} from "./mobile-projects.js";

const conversations = [
  { id: "a", projectId: "p1" },
  { id: "b", projectId: "p1" },
  { id: "c", projectId: "p2" },
  { id: "d", projectId: "p3" },
];
const activity = {
  a: { indicator: "running" },
  b: { indicator: "needs-user" },
  c: { indicator: "idle" },
  d: { indicator: "awaiting-async" },
};

test("counts what is running and what needs the reader", () => {
  const counts = projectCounts(["p1"], conversations, activity);
  assert.deepEqual(counts, { running: 1, needsYou: 1, background: 0 });
  assert.equal(projectCountsLine(counts), "1 running · 1 needs you");
});

test("nested project ids count toward one entry", () => {
  const counts = projectCounts(["p1", "p3"], conversations, activity);
  assert.equal(counts.background, 1);
  assert.equal(
    projectCountsLine(counts),
    "1 running · 1 needs you · 1 in background",
  );
});

test("projects with live work are Active, the rest Recent", () => {
  const items = [
    { key: "p2", projectIds: ["p2"] },
    { key: "p3", projectIds: ["p3"] },
    { key: "p1", projectIds: ["p1"] },
  ];
  const groups = groupMobileProjects(items, conversations, activity);
  assert.deepEqual(
    groups.active.map((entry) => entry.item.key),
    ["p1", "p3"],
  );
  assert.deepEqual(
    groups.recent.map((item) => item.key),
    ["p2"],
  );
});
