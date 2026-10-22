import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectHarnessOverridesSchema,
  projectHarnessValuesSchema,
  projectSettingsPatchSchema,
} from "../../src/domains/settings/project-settings.js";

test("project patches accept sparse nested overrides and removals without injecting defaults", () => {
  const patch = {
    defaultAgentProfile: null,
    defaults: { thinkingLevel: "high" },
    compaction: { auto: false },
  };
  assert.deepEqual(projectSettingsPatchSchema.parse(patch), patch);
  assert.deepEqual(projectHarnessOverridesSchema.parse({ defaults: {} }), {
    defaults: {},
  });
});

test("project patch validation excludes daemon/user metadata, capability selections, extension edits and invalid values", () => {
  for (const patch of [
    { daemon: {} },
    { version: 4 },
    { tools: { disabled: [] } },
    { tools: { bash: { shellPath: "/bin/sh" } } },
    { skills: { disabled: [] } },
    { skills: { agentBrowser: { enabled: [] } } },
    { vendor: true },
    { execution: { vendor: true } },
    { defaultAgentProfile: "bad/name" },
    { compaction: { customTriggerPercent: 95 } },
    { retry: { maxRetries: -1 } },
  ])
    assert.equal(
      projectSettingsPatchSchema.safeParse(patch).success,
      false,
      JSON.stringify(patch),
    );
});

test("own settings preserve extension data but effective resolution only sees validated known fields", () => {
  const raw = {
    version: 4,
    defaultAgentProfile: "planning",
    vendor: true,
    execution: { shellPath: "/bin/sh", vendor: { enabled: true } },
  };
  assert.deepEqual(projectHarnessOverridesSchema.parse(raw), raw);
  assert.deepEqual(projectHarnessValuesSchema.parse(raw), {
    defaultAgentProfile: "planning",
  });
});
