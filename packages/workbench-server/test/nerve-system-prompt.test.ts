import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNerveSystemPrompt } from "../src/domains/agents/prompting/nerve-system-prompt.js";

describe("Nerve system prompt", () => {
  it("keeps the environment stable and excludes runtime task state", () => {
    const options = {
      cwd: "C:\\workspace\\nerve",
      selectedTools: ["read", "task_start", "task_status"],
    };

    const first = buildNerveSystemPrompt(options);
    const second = buildNerveSystemPrompt(options);

    assert.equal(first, second);
    assert.match(first, /<environment>\nCurrent date: \d{4}-\d{2}-\d{2}\n/);
    assert.match(first, /Current working directory: C:\/workspace\/nerve/);
    assert.doesNotMatch(first, /Current (?:time|timestamp):/i);
    assert.doesNotMatch(first, /Active background tasks/i);
  });

  it("changes when intentional cache-prefix inputs change", () => {
    const coding = buildNerveSystemPrompt({
      cwd: "/workspace/nerve",
      mode: "coding",
      selectedTools: ["read"],
    });
    const planning = buildNerveSystemPrompt({
      cwd: "/workspace/nerve",
      mode: "planning",
      selectedTools: ["read", "plan_mode_enter"],
      planDir: "/tmp/plans",
    });

    assert.notEqual(coding, planning);
    assert.doesNotMatch(coding, /<plan_mode active="true"/);
    assert.match(planning, /<plan_mode active="true"/);
    assert.match(planning, /plan_dir="\/tmp\/plans"/);
  });
});
