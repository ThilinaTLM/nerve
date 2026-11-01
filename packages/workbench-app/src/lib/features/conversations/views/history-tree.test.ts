import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationTreeNode } from "$lib/presentation/view-models/conversation";
import {
  buildHistoryFlow,
  buildHistoryTree,
  findHistoryMatches,
  historyKeyTarget,
  historyLayout,
  HISTORY_ROOT_ID,
} from "./history-tree";

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

// u1 → [call, result, call, result] → a1 → u2 → a2 ; fork at a1: u3 → a3
const specs: Spec[] = [
  { id: "u1", role: "user", text: "first question" },
  call("t1", "u1", "bash"),
  result("r1", "t1", "bash"),
  call("t2", "r1", "read"),
  result("r2", "t2", "read"),
  { id: "a1", parent: "r2", role: "assistant", text: "first answer" },
  { id: "u2", parent: "a1", role: "user", text: "second question" },
  { id: "a2", parent: "u2", role: "assistant", text: "second answer" },
  { id: "u3", parent: "a1", role: "user", text: "edited question" },
  { id: "a3", parent: "u3", role: "assistant", text: "edited answer" },
];

test("tool steps fold into the reply that follows them", () => {
  const model = buildHistoryTree(tree(specs), "a2");
  assert.deepEqual(
    [...model.order].sort(),
    [HISTORY_ROOT_ID, "u1", "a1", "u3", "a3", "u2", "a2"].sort(),
  );
  for (const folded of ["t1", "r1", "t2", "r2"]) {
    assert.equal(model.nodes.has(folded), false);
    assert.equal(model.ownerOf.get(folded), "a1");
  }
  const reply = model.nodes.get("a1")!;
  assert.equal(reply.toolCount, 2);
  assert.deepEqual(
    reply.steps.map((s) => [s.label, s.count]),
    [
      ["bash", 1],
      ["read", 1],
    ],
  );
  assert.equal(model.entryCount, specs.length);
});

test("the branch that continues the current path is last at a fork", () => {
  const model = buildHistoryTree(tree(specs), "a2");
  assert.deepEqual(model.nodes.get("a1")!.childIds, ["u3", "u2"]);
  assert.equal(model.nodes.get("a1")!.role, "fork");
  assert.equal(model.headId, "a2");
  assert.equal(model.nodes.get("a3")!.current, false);
  assert.equal(model.branchCount, 2);
});

test("a branch ending in steps folds them back into its last message", () => {
  const withTip = [...specs.slice(0, 3)];
  const model = buildHistoryTree(tree(withTip), "r1");
  assert.equal(model.headId, "u1");
  assert.equal(model.nodes.has("t1"), false);
  assert.equal(model.nodes.has("r1"), false);
  assert.equal(model.nodes.get("u1")!.head, true);
  assert.equal(model.nodes.get("u1")!.role, "tip");
  assert.equal(model.nodes.get("u1")!.toolCount, 1);
});

test("live tool-call placeholders without arguments fold too", () => {
  const live: Spec[] = [
    { id: "u1", role: "user", text: "question" },
    {
      id: "t1",
      parent: "u1",
      role: "assistant",
      text: "[Tool call: bash, edit]",
    },
    { id: "a1", parent: "t1", role: "assistant", text: "answer" },
  ];
  const model = buildHistoryTree(tree(live), "a1");
  assert.equal(model.nodes.has("t1"), false);
  assert.equal(model.ownerOf.get("t1"), "a1");
});

test("without a known active entry the start is the head", () => {
  const model = buildHistoryTree(tree(specs), undefined);
  assert.equal(model.headId, HISTORY_ROOT_ID);
  assert.equal(model.nodes.get(HISTORY_ROOT_ID)!.head, true);
});

test("extra root entries become branches of the start", () => {
  const model = buildHistoryTree(
    tree([...specs, { id: "u9", role: "user", text: "from the beginning" }]),
    "a2",
  );
  assert.equal(model.nodes.get(HISTORY_ROOT_ID)!.childIds.length, 2);
  assert.equal(model.nodes.get(HISTORY_ROOT_ID)!.childIds.at(-1), "u1");
});

test("arrow keys walk parent, continuing child and sibling branches", () => {
  const model = buildHistoryTree(tree(specs), "a2");
  assert.equal(historyKeyTarget(model, "a1", "ArrowUp"), "u1");
  assert.equal(historyKeyTarget(model, "a1", "ArrowDown"), "u2");
  assert.equal(historyKeyTarget(model, "u2", "ArrowLeft"), "u3");
  assert.equal(historyKeyTarget(model, "u3", "ArrowRight"), "u2");
  assert.equal(historyKeyTarget(model, "u2", "ArrowRight"), undefined);
  assert.equal(historyKeyTarget(model, "a3", "Home"), HISTORY_ROOT_ID);
  assert.equal(historyKeyTarget(model, "a3", "End"), "a2");
});

test("search finds folded steps through their reply", () => {
  const model = buildHistoryTree(tree(specs), "a2");
  assert.deepEqual(findHistoryMatches(model, "question"), ["u1", "u2", "u3"]);
  assert.deepEqual(findHistoryMatches(model, "tool call: read"), ["a1"]);
  assert.deepEqual(findHistoryMatches(model, "q"), []);
});

test("flow nodes carry label width and edges mark the current path", () => {
  const model = buildHistoryTree(tree(specs), "a2");
  const flow = buildHistoryFlow(model, historyLayout(model));
  assert.equal(flow.nodes.length, model.nodes.size);
  assert.equal(flow.edges.length, model.nodes.size - 1);
  const side = flow.edges.find((edge) => edge.target === "u3")!;
  const main = flow.edges.find((edge) => edge.target === "u2")!;
  assert.match(main.style, /--primary/);
  assert.match(side.style, /--muted-foreground/);
  const u3 = flow.nodes.find((node) => node.id === "u3")!;
  const u2 = flow.nodes.find((node) => node.id === "u2")!;
  assert.ok(u3.position.x < u2.position.x);
  assert.ok(u3.data.labelWidth < 360);
  assert.equal(flow.nodes.find((n) => n.id === "a1")!.data.toolCount, 2);
});
