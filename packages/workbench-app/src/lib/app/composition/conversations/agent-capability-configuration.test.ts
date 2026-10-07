import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  emptyCapabilityOverrides,
  capabilityToolSettingsFromSettings,
  type CapabilityConfiguration,
} from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  agentCapabilityPatch,
  agentCapabilityConfiguration,
  selectedAgentSkillNames,
  type AgentSkillOption,
} from "./agent-capability-configuration";

const skills: AgentSkillOption[] = [
  { name: "first", kind: "file", enabled: true },
  { name: "second", kind: "nerve", enabled: true },
  { name: "third", kind: "agentBrowser", enabled: false },
];
const selection = {
  disabledTools: ["explore" as const],
  toolProfiles: { web_search: "shared-profile" },
  toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
  disabledFileSkills: [],
  enabledNerveSkills: ["second"],
  enabledAgentBrowserSkills: [],
};
const base: CapabilityConfiguration = {
  project: emptyCapabilityOverrides(),
  conversation: emptyCapabilityOverrides(),
  inherited: selection,
  effective: selection,
  availableTools: ["explore", "web_search"],
  toolProfileOptions: { jira: [], confluence: [], web_search: [] },
  trust: { status: "missing" },
};

it("toggles one inherited skill without dropping the others; null inherits and [] disables all", () => {
  const actor = { tools: null, skills: null } as AgentRecord;
  assert.deepEqual(selectedAgentSkillNames(actor, skills), ["first", "second"]);
  const off = agentCapabilityPatch(
    actor,
    { skills: { file: { first: false } } },
    skills,
    base,
  );
  assert.deepEqual(off.skills, ["second"]);
  const on = agentCapabilityPatch(
    actor,
    { skills: { agentBrowser: { third: true } } },
    skills,
    base,
  );
  assert.deepEqual(on.skills, ["first", "second", "third"]);
  assert.equal(actor.skills, null);
  const excluded = agentCapabilityConfiguration(
    base,
    { ...actor, skills: [] },
    skills,
  );
  assert.deepEqual(excluded.effective.disabledFileSkills, ["first"]);
  assert.deepEqual(excluded.effective.enabledNerveSkills, []);
  assert.equal(excluded.conversation?.skills.file.first, false);
  assert.deepEqual(
    agentCapabilityConfiguration(base, actor, skills).effective,
    selection,
  );
});
it("root and child boolean controls edit only their own selection and preserve shared profiles", () => {
  const root = {
    id: "agent_root",
    tools: [],
    skills: [],
  } as unknown as AgentRecord;
  const sibling = {
    id: "agent_child",
    tools: ["read", "explore"],
    skills: ["second"],
  } as unknown as AgentRecord;
  assert.ok(
    agentCapabilityConfiguration(
      base,
      root,
      skills,
    ).effective.disabledTools.includes("explore"),
  );
  const edit = agentCapabilityPatch(
    root,
    { tools: { explore: { enabled: true } } },
    skills,
    base,
  );
  assert.deepEqual(edit.tools, ["explore"]);
  assert.ok(
    !agentCapabilityConfiguration(
      base,
      { ...root, tools: edit.tools },
      skills,
    ).effective.disabledTools.includes("explore"),
  );
  assert.deepEqual(sibling.tools, ["read", "explore"]);
  assert.deepEqual(root.tools, []);
  assert.equal(base.effective.toolProfiles.web_search, "shared-profile");
  assert.deepEqual(
    agentCapabilityPatch(
      root,
      { tools: { web_search: { profileId: "another-shared-profile" } } },
      skills,
      base,
    ),
    {},
  );
});
it("resetting one explicit skill adopts its inherited default while preserving other choices", () => {
  const actor = { tools: ["read"], skills: ["third"] } as AgentRecord;
  const patch = agentCapabilityPatch(
    actor,
    { skills: { file: { first: null } } },
    skills,
    base,
  );
  assert.deepEqual(patch.skills, ["third", "first"]);
});
