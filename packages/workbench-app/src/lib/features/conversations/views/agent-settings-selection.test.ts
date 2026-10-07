import assert from "node:assert/strict";
import { it } from "node:test";
import {
  agentSettingsSelection,
  agentSettingsPatch,
} from "./agent-settings-selection";
it("instruction-only saves keep inherited tools and skills null, while explicit empty remains disabled", () => {
  const inherited = { inherit: true, text: "" };
  assert.equal(agentSettingsSelection(inherited.inherit, inherited.text), null);
  assert.deepEqual(agentSettingsSelection(false, ""), []);
  assert.deepEqual(agentSettingsSelection(false, "first\n second \n\n"), [
    "first",
    "second",
  ]);
  assert.equal(agentSettingsSelection(true, "previous explicit skill"), null);
  const initial = { tools: null, skills: null, instructions: "before" };
  assert.deepEqual(
    agentSettingsPatch(initial, { ...initial, instructions: "after" }),
    { instructions: "after" },
  );
  assert.deepEqual(agentSettingsPatch(initial, { ...initial, skills: [] }), {
    skills: [],
  });
  assert.deepEqual(
    agentSettingsPatch({ ...initial, skills: [] }, { ...initial, skills: [] }),
    {},
  );
});
