import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { loadBundledAgentProfiles } from "./builtin-profile-loader.js";

const schema = z
  .object({
    name: z.string().min(1),
    instructions: z.string(),
    tools: z.record(z.string(), z.object({ enabled: z.boolean() })),
  })
  .strict();

void test("bundled profile definitions must validate and match their asset names", () => {
  assert.throws(
    () =>
      loadBundledAgentProfiles(
        { coding: { name: "planning", instructions: "", tools: {} } },
        schema,
      ),
    /coding.json declares the name "planning"/,
  );
  assert.throws(() =>
    loadBundledAgentProfiles(
      { coding: { name: "coding", instructions: false, tools: {} } },
      schema,
    ),
  );
});

void test("bundled profile catalogs and nested configuration are frozen without freezing the JSON input", () => {
  const document = {
    name: "planning",
    instructions: "Plan first",
    tools: { plan_present: { enabled: true } },
  };
  const profiles = loadBundledAgentProfiles({ planning: document }, schema);
  assert.ok(Object.isFrozen(profiles));
  assert.ok(Object.isFrozen(profiles[0]));
  assert.ok(Object.isFrozen(profiles[0].tools.plan_present));
  assert.throws(() => {
    profiles[0].tools.plan_present.enabled = false;
  }, TypeError);
  assert.equal(document.tools.plan_present.enabled, true);
  assert.ok(!Object.isFrozen(document.tools));
});
