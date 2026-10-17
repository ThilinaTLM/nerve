import assert from "node:assert/strict";
import { test } from "node:test";
import { compareSubagents } from "./subagent-order";

const at = (day: number) =>
  `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

test("parent prompts outrank creation, activity and status changes", () => {
  const agents = [
    {
      id: "old-prompt",
      name: "A",
      lastParentPromptAt: at(1),
      createdAt: at(3),
      updatedAt: at(9),
      status: "running",
    },
    {
      id: "new-prompt",
      name: "B",
      lastParentPromptAt: at(2),
      createdAt: at(1),
      updatedAt: at(2),
      status: "idle",
    },
  ];
  const order = () => [...agents].sort(compareSubagents).map((a) => a.id);
  assert.deepEqual(order(), ["new-prompt", "old-prompt"]);
  agents[0]!.updatedAt = at(10);
  agents[1]!.status = "running";
  assert.deepEqual(order(), ["new-prompt", "old-prompt"]);
});

test("ties use newest creation, then name, then stable identity", () => {
  const agents = [
    { id: "b", name: "Alpha", createdAt: at(2) },
    { id: "z", name: "Zulu", createdAt: at(2) },
    { id: "old", name: "A", createdAt: at(1) },
    { id: "a", name: "Alpha", createdAt: at(2) },
  ].map((agent) => ({ ...agent, lastParentPromptAt: at(3) }));
  assert.deepEqual(
    agents.sort(compareSubagents).map((a) => a.id),
    ["a", "b", "z", "old"],
  );
});

test("unprompted children follow prompted children, with creation/name fallbacks", () => {
  const agents = [
    { id: "missing", title: "Z", createdAt: at(3) },
    {
      id: "invalid",
      title: "A",
      createdAt: at(3),
      lastParentPromptAt: "invalid",
    },
    { id: "prompted", title: "B", createdAt: at(1), lastParentPromptAt: at(1) },
  ];
  assert.deepEqual(
    agents.sort(compareSubagents).map((a) => a.id),
    ["prompted", "invalid", "missing"],
  );
});
