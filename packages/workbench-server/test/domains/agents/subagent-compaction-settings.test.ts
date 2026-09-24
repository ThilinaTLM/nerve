import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { Settings } from "@nervekit/contracts/settings";
import { compactionSettingsForAgent } from "../../../src/domains/agents/execution/subagent-compaction-settings.js";

const lead = { executionKind: "lead" } as AgentRecord;
const child = { executionKind: "async_developer" } as AgentRecord;
const settings = {
  compaction: {
    auto: false,
    profile: "balanced",
    customTriggerPercent: 78,
    customKeepRecentPercent: 12,
  },
  asyncSubagent: {
    compactionProfile: "inherit",
    customTriggerPercent: 85,
    customKeepRecentPercent: 20,
  },
} as Settings;

it("inherits the effective policy for teammates by default", () => {
  assert.equal(
    compactionSettingsForAgent(settings, child),
    settings.compaction,
  );
});

it("uses a child profile without changing the lead or enabling disabled auto-compaction", () => {
  const selected = {
    ...settings,
    asyncSubagent: { ...settings.asyncSubagent, compactionProfile: "custom" },
  } as Settings;
  assert.deepEqual(compactionSettingsForAgent(selected, child), {
    auto: false,
    profile: "custom",
    customTriggerPercent: 85,
    customKeepRecentPercent: 20,
  });
  assert.equal(compactionSettingsForAgent(selected, lead), selected.compaction);
  assert.equal(compactionSettingsForAgent(selected), selected.compaction);
});
