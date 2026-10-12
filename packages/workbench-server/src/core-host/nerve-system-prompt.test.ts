import assert from "node:assert/strict";
import test from "node:test";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";

function assertUserOwnedMode(prompt: string) {
  assert.match(prompt, /Conversation mode is user-controlled/);
  assert.match(
    prompt,
    /Only the user can enter planning mode or manually leave it/,
  );
  assert.match(
    prompt,
    /Presenting a plan with plan_mode_present does not change mode/,
  );
  assert.match(
    prompt,
    /User approval of the plan switches to coding mode; rejection leaves the mode unchanged/,
  );
  assert.doesNotMatch(
    prompt,
    /plan_mode_enter|plan_mode_force_exit|Use Plan Mode only/,
  );
}

void test("default coding prompt leaves mode changes to the user", () => {
  const prompt = buildNerveSystemPrompt({ cwd: "/w", mode: "coding" });
  assertUserOwnedMode(prompt);
  assert.doesNotMatch(prompt, /<plan_mode active=/);
});

void test("planning prompt retains read-only work and user-approved implementation", () => {
  const prompt = buildNerveSystemPrompt({
    cwd: "/w",
    mode: "planning",
    planDir: "/plans",
    selectedTools: ["read", "plan_mode_present"],
  });
  assertUserOwnedMode(prompt);
  assert.match(prompt, /<plan_mode active="true" plan_dir="\/plans">/);
  assert.match(
    prompt,
    /Keep research read-only; write only plan files under plan_dir/,
  );
  assert.match(
    prompt,
    /Present the plan with plan_mode_present and obtain approval before implementation/,
  );
});

for (const mode of ["coding", "planning"] as const) {
  void test(`custom ${mode} prompt receives additive user-owned mode guidance`, () => {
    const customPrompt = "Follow this custom persona exactly.";
    const prompt = buildNerveSystemPrompt({
      cwd: "/w",
      mode,
      customPrompt,
    });
    assert.ok(prompt.startsWith(`${customPrompt}\n\n`));
    assertUserOwnedMode(prompt);
    assert.doesNotMatch(prompt, /You are Nerve's coding agent/);
  });
}
