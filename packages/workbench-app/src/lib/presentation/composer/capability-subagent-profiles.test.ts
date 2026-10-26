import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import {
  capabilitySubagentCounts,
  capabilitySubagentEnabled,
} from "./capability-subagent-profiles";

const profiles = [
  { name: "off-by-default", label: "Off by default", defaultEnabled: false },
  { name: "on", label: "On" },
  { name: "untrusted", label: "Untrusted", error: "Needs trust" },
];

void test("launch defaults are overridable, but unavailable profiles never count as available", () => {
  assert.equal(capabilitySubagentEnabled(profiles[0]!, undefined), false);
  assert.equal(capabilitySubagentEnabled(profiles[1]!, undefined), true);
  assert.deepEqual(capabilitySubagentCounts(profiles), {
    available: 1,
    total: 3,
  });
  assert.deepEqual(
    capabilitySubagentCounts(profiles, {
      "off-by-default": { enabled: true },
      on: { enabled: false },
      untrusted: { enabled: true },
    }),
    { available: 1, total: 3 },
  );
});

void test("counts and launch switches reflect conversation overrides over user/project off", () => {
  const resolution = resolveAgentConfiguration({
    role: "lead",
    subagentDefaults: { "off-by-default": false },
    user: { subagents: { "off-by-default": { enabled: false } } },
    project: { subagents: { on: { enabled: false } } },
    conversation: {
      subagents: {
        "off-by-default": { enabled: true },
        on: { enabled: true },
      },
    },
  });
  assert.equal(
    capabilitySubagentEnabled(profiles[0]!, resolution.settings.subagents),
    true,
  );
  assert.deepEqual(
    capabilitySubagentCounts(profiles, resolution.settings.subagents),
    {
      available: 2,
      total: 3,
    },
  );
});
