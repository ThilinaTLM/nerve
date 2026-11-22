import assert from "node:assert/strict";
import { test } from "node:test";
import { agentOverridePointers } from "./project-page-diffs";

const overrides = {
  reasoningLevel: "high",
  tools: { web_search: { enabled: false } },
  skills: { nerve: { docs: true }, defaults: { file: false } },
  subagents: { explore: { enabled: false } },
} as never;

void test("project agent overrides are split by the page that shows them", () => {
  assert.deepEqual(agentOverridePointers(overrides, "general"), [
    "/reasoningLevel",
  ]);
  assert.deepEqual(agentOverridePointers(overrides, "tools"), [
    "/tools/web_search/enabled",
  ]);
  assert.equal(agentOverridePointers(overrides, "skills").length, 2);
  assert.deepEqual(agentOverridePointers(overrides, "sub-agents"), [
    "/subagents/explore/enabled",
  ]);
});
