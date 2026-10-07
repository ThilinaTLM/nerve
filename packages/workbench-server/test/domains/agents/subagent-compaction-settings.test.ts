import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { Settings } from "@nervekit/contracts/settings";
import { compactionSettingsForAgent } from "../../../src/domains/agents/execution/subagent-compaction-settings.js";

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
