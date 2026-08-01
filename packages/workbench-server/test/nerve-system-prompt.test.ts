import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNerveSystemPrompt } from "../src/domains/agents/prompting/nerve-system-prompt.js";

describe("Nerve system prompt environment", () => {
  it("shows completed and open todo counts alongside active tasks", () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/workspace/project",
      selectedTools: ["todos_get", "todos_set", "task_status"],
      activeBackgroundTaskIds: ["task_1"],
      todos: [{ done: true }, { done: true }, { done: false }],
    });

    assert.match(prompt, /Active background tasks \(1\): task_1/);
    assert.match(prompt, /Todo progress: 2\/3 complete \(1 open\)/);
  });

  it("shows zero open items for a completed non-empty list", () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/workspace/project",
      selectedTools: ["todos_get"],
      todos: [{ done: true }, { done: true }],
    });

    assert.match(prompt, /Todo progress: 2\/2 complete \(0 open\)/);
  });

  it("omits todo progress for an empty or absent list", () => {
    const emptyPrompt = buildNerveSystemPrompt({
      cwd: "/workspace/project",
      selectedTools: ["todos_get"],
      todos: [],
    });
    const absentPrompt = buildNerveSystemPrompt({
      cwd: "/workspace/project",
      selectedTools: ["todos_get"],
    });

    assert.doesNotMatch(emptyPrompt, /Todo progress:/);
    assert.doesNotMatch(absentPrompt, /Todo progress:/);
  });

  it("does not expose todo state when todo tools are unavailable", () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/workspace/project",
      selectedTools: ["read"],
      todos: [{ done: false }],
    });

    assert.doesNotMatch(prompt, /Todo progress:/);
  });
});
