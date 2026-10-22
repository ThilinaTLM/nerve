import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  agentProfileSettingSchema,
  agentProfileSettingKind,
  lockedValue,
} from "../../src/domains/agent-profiles/scalar.js";

test("settings have explicit lead/set/lock modes and omission alone means use-settings", () => {
  const schema = agentProfileSettingSchema(z.string());
  for (const value of ["lead", { set: "x" }, { lock: "x" }])
    assert.equal(schema.safeParse(value).success, true);
  for (const value of ["inherit", "default", "x", {}, { set: "x", lock: "x" }])
    assert.equal(schema.safeParse(value).success, false);
  assert.equal(agentProfileSettingKind(), "use-settings");
  assert.equal(agentProfileSettingKind("lead"), "lead");
  assert.equal(agentProfileSettingKind({ set: "x" }), "set");
  assert.equal(agentProfileSettingKind({ lock: "x" }), "lock");
  assert.equal(lockedValue({ set: "x" }), undefined);
  assert.equal(lockedValue({ lock: "x" }), "x");
});
