import assert from "node:assert/strict";
import { test } from "node:test";
import { builtInAgentProfiles } from "./builtin-agent-profiles.js";

void test("Coding resets Planning's permission and plan tool to settings, while Planning captures the coding approval target", () => {
  const coding = builtInAgentProfiles.find(
    (profile) => profile.name === "coding",
  )!;
  assert.equal(coding.model, undefined);
  assert.equal(coding.thinking, undefined);
  assert.equal(coding.permission, "settings");
  assert.equal(coding.compaction, undefined);
  assert.equal(coding.skills, undefined);
  assert.deepEqual(coding.tools, { plan_present: "settings" });
  const planning = builtInAgentProfiles.find(
    (profile) => profile.name === "planning",
  )!;
  assert.equal(planning.usableBy, "lead");
  assert.deepEqual(planning.permission, { lock: "planning" });
  assert.deepEqual(planning.tools?.plan_present, {
    set: { enabled: true, settings: { approvalProfile: "coding" } },
  });
  assert.ok(Object.isFrozen(planning.tools?.plan_present));
  for (const name of ["developer", "explore"]) {
    const child = builtInAgentProfiles.find(
      (profile) => profile.name === name,
    )!;
    assert.equal(child.model, "lead");
    assert.equal(child.thinking, "lead");
  }
});
