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
  assert.match(prompt, /After rejection, wait for a new user prompt/);
  assert.doesNotMatch(
    prompt,
    /plan_mode_enter|plan_mode_force_exit|Use Plan Mode only/,
  );
}

function assertNoPlanningGuidance(prompt: string) {
  assert.doesNotMatch(
    prompt,
    /<mode_controls>|<plan_mode|plan_mode_present|planning mode|plan_dir/,
  );
}

for (const mode of [undefined, "coding"] as const) {
  void test(`${mode ?? "default"} prompt omits planning guidance`, () => {
    const prompt = buildNerveSystemPrompt({ cwd: "/w", mode });
    assertNoPlanningGuidance(prompt);
  });
}

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
  void test(`custom ${mode} prompt receives mode-appropriate guidance`, () => {
    const customPrompt = "Follow this custom persona exactly.";
    const prompt = buildNerveSystemPrompt({
      cwd: "/w",
      mode,
      customPrompt,
    });
    assert.ok(prompt.startsWith(`${customPrompt}\n\n`));
    if (mode === "planning") {
      assertUserOwnedMode(prompt);
      assert.match(prompt, /<plan_mode active="true"/);
    } else assertNoPlanningGuidance(prompt);
    assert.doesNotMatch(prompt, /You are Nerve's coding agent/);
  });
}
