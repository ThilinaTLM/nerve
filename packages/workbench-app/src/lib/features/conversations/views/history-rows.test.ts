import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationTreeNode } from "$lib/presentation/view-models/conversation";
import { buildHistoryTree, HISTORY_ROOT_ID } from "./history-tree";
import {
  buildHistoryItems,
  defaultFoldedBranches,
  itemsAfterOnCurrentPath,
  layoutHistoryRows,
  historySpanLabel,
  matchHistoryItems,
} from "./history-rows";

type Spec = {
  id: string;
  parent?: string;
  role: "user" | "assistant" | "system";
  text: string;
  details?: unknown;
};

function tree(specs: Spec[]): ConversationTreeNode[] {
  return specs.map((spec, index) => ({
    entry: {
      id: spec.id,
      conversationId: "c",
      role: spec.role,
      kind: spec.role === "system" ? "tool_result" : "message",
      text: spec.text,
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
      parentEntryId: spec.parent,
      details: spec.details,
    },
    childEntryIds: specs.filter((s) => s.parent === spec.id).map((s) => s.id),
  }));
}

const user = (id: string, parent: string | undefined, text = id): Spec => ({
  id,
  parent,
  role: "user",
  text,
});
const reply = (id: string, parent: string, text = id): Spec => ({
  id,
  parent,
  role: "assistant",
  text,
});
const call = (id: string, parent: string, name: string): Spec => ({
  id,
  parent,
  role: "assistant",
  text: `[Tool call: ${name}({})]`,
});
const result = (id: string, parent: string, name: string): Spec => ({
  id,
  parent,
  role: "system",
  text: "ok",
  details: { toolName: name },
});

// u1 → a1 → u2 → a2 → u4 → a4 (head)
//            ↘ u3 → a3 (side branch from a1)
const specs: Spec[] = [
  user("u1", undefined, "deploy the firewall script"),
  call("t1", "u1", "bash"),
  result("r1", "t1", "bash"),
  reply("a1", "r1", "done"),
  user("u2", "a1"),
  reply("a2", "u2"),
  user("u3", "a1", "try terraform instead"),
  reply("a3", "u3"),
  user("u4", "a2"),
  reply("a4", "u4"),
];

test("messages mode keeps messages and final replies as separate items", () => {
  const model = buildHistoryItems(
    buildHistoryTree(tree(specs), "a4"),
    "messages",
  );
  assert.deepEqual(model.order, [
    HISTORY_ROOT_ID,
    "u1",
    "a1",
    "u3",
    "a3",
    "u2",
    "a2",
    "u4",
    "a4",
  ]);
  const reply = model.items.get("a1")!;
  assert.equal(reply.targetId, "a1");
  assert.equal(reply.toolCount, 1);
  assert.deepEqual(model.items.get("u1")!.childIds, ["a1"]);
  assert.deepEqual(reply.childIds, ["u3", "u2"]);
  assert.equal(model.headId, "a4");
  assert.equal(model.items.get("a4")!.head, true);
});

test("current path stays in lane 0 and side branches fork beside it", () => {
  const model = buildHistoryItems(
    buildHistoryTree(tree(specs), "a4"),
    "messages",
  );
  const { rows, laneCount } = layoutHistoryRows(model);
  assert.equal(laneCount, 2);
  assert.deepEqual(
    rows.map((row) => [row.itemId, row.lane]),
    [
      [HISTORY_ROOT_ID, 0],
      ["u1", 0],
      ["a1", 0],
      ["u3", 1],
      ["a3", 1],
      ["u2", 0],
      ["a2", 0],
      ["u4", 0],
      ["a4", 0],
    ],
  );
  const fork = rows[2]!;
  assert.deepEqual(fork.forks, [{ lane: 1, current: false }]);
  // The current path passes beside the side branch, then resumes.
  assert.deepEqual(rows[3]!.pass, [{ lane: 0, current: true }]);
  assert.equal(rows[3]!.up, false);
  assert.equal(rows[4]!.down, undefined);
  assert.equal(rows[8]!.down, undefined);
});

test("long side branches fold unless they hold something to keep", () => {
  const long: Spec[] = [
    ...specs,
    user("u5", "a3"),
    reply("a5", "u5"),
    user("u6", "a5"),
  ];
  const model = buildHistoryItems(
    buildHistoryTree(tree(long), "a4"),
    "messages",
  );
  const folded = defaultFoldedBranches(model, new Set());
  assert.deepEqual([...folded], ["u3"]);
  const { rows } = layoutHistoryRows(model, folded);
  assert.deepEqual(rows[3], {
    itemId: "u3",
    lane: 1,
    folded: { count: 5 },
    pass: [{ lane: 0, current: true }],
    up: false,
    forks: [],
  });
  assert.equal(defaultFoldedBranches(model, new Set(["u6"])).size, 0);
});

test("steps mode keeps every message as its own item", () => {
  const model = buildHistoryItems(buildHistoryTree(tree(specs), "a4"), "steps");
  assert.ok(model.items.has("a1"));
  assert.equal(model.items.get("u1")!.targetId, "u1");
  assert.equal(model.headId, "a4");
});

test("rewind preview counts the later items on the current path", () => {
  const model = buildHistoryItems(
    buildHistoryTree(tree(specs), "a4"),
    "messages",
  );
  assert.equal(itemsAfterOnCurrentPath(model, "a1"), 4);
  assert.equal(itemsAfterOnCurrentPath(model, "a4"), 0);
  assert.equal(itemsAfterOnCurrentPath(model, "a3"), 0);
});

test("search matches messages and folded steps", () => {
  const model = buildHistoryItems(
    buildHistoryTree(tree(specs), "a4"),
    "messages",
  );
  assert.deepEqual([...matchHistoryItems(model, "terraform")], ["u3"]);
  assert.deepEqual([...matchHistoryItems(model, "f")], []);
});

test("span labels stay compact", () => {
  const at = (s: number) =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  assert.equal(historySpanLabel(at(0), at(0)), undefined);
  assert.equal(historySpanLabel(at(0), at(45)), "45s");
  assert.equal(historySpanLabel(at(0), at(192)), "3m 12s");
  assert.equal(historySpanLabel(at(0), at(7500)), "2h 5m");
  assert.equal(historySpanLabel(at(0), at(90_000)), undefined);
});
