import assert from "node:assert/strict";
import { test } from "node:test";
import { profileDefinitionSchema } from "@nervekit/contracts/agent-configuration";
import { bundledAgentProfiles } from "./index.js";

void test("every built-in profile is valid and keyed by its own name", () => {
  for (const [name, bytes] of Object.entries(bundledAgentProfiles)) {
    const definition = profileDefinitionSchema.parse(JSON.parse(bytes));
    assert.equal(definition.name, name);
  }
});
