import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentOverridePointers,
  agentOverrideResets,
  differingExtensionCount,
  differingSuggestionCount,
  mergeDiffCounts,
} from "./project-page-diffs";

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
  assert.deepEqual(agentOverrideResets(overrides, "sub-agents"), [
    "/overrides/subagents/explore/enabled",
  ]);
});

void test("diff counts add up per page and omit empty ones", () => {
  assert.deepEqual(
    mergeDiffCounts({ agents: 1, tools: 0 }, { agents: 2, skills: 3 }),
    { agents: 3, skills: 3 },
  );
});

void test("a stored project value equal to User's is not a difference", () => {
  const view = (
    entries: Record<string, { enabled: boolean; stored: unknown }>,
  ) =>
    ({
      extensions: Object.entries(entries).map(([id, { enabled, stored }]) => ({
        metadata: { id },
        enabled: { value: enabled },
        fields: { backend: { value: "a" } },
        stored,
      })),
    }) as never;
  const user = view({
    one: { enabled: true, stored: null },
    two: { enabled: false, stored: null },
    three: { enabled: true, stored: null },
  });
  const project = view({
    one: { enabled: true, stored: { enabled: true, settings: {} } },
    two: { enabled: true, stored: { enabled: true, settings: {} } },
    three: { enabled: true, stored: { settings: { backend: "b" } } },
  });
  assert.equal(differingExtensionCount(project, user), 2);
  assert.equal(differingExtensionCount(project, undefined), 0);
  assert.equal(
    differingSuggestionCount([
      { projectEnabled: true, userEnabled: true, defaultEnabled: false },
      { projectEnabled: true, defaultEnabled: false },
      { projectEnabled: false, defaultEnabled: false },
      { defaultEnabled: true },
    ]),
    1,
  );
});
