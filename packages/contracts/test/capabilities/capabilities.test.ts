import { asyncSubagentToolNames } from "../../src/domains/agents/async-subagents.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCapabilityPatch,
  capabilityToolsFromDisabledNames,
  disabledToolNamesForCapabilities,
  capabilityPatchSchema,
  capabilityOverridesDocumentSchema,
  emptyCapabilityOverrides,
  resolveCapabilitySelection,
} from "../../src/domains/capabilities/capabilities.js";

const user = {
  disabledTools: ["python_exec" as const],
  disabledFileSkills: ["release"],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: ["core"],
};

test("capability selection composes user, project, and conversation scopes", () => {
  const project = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { python_exec: true, web_search: false },
    skills: {
      file: { release: true, deploy: false },
      nerve: { "skill-creator": true },
      agentBrowser: { core: false, browser: true },
    },
  });
  const conversation = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { web_search: true },
    skills: {
      file: { deploy: true },
      nerve: { "skill-creator": false },
      agentBrowser: { browser: false },
    },
  });

  assert.deepEqual(
    resolveCapabilitySelection({ user, project, conversation }),
    {
      disabledTools: [],
      disabledFileSkills: [],
      enabledNerveSkills: [],
      enabledAgentBrowserSkills: [],
    },
  );
});

test("missing entries inherit and null patches remove an override", () => {
  const document = applyCapabilityPatch(emptyCapabilityOverrides(), {
    tools: { explore: false },
    skills: {
      file: { release: false },
      nerve: { "skill-creator": true },
    },
  });
  assert.equal(document.tools.explore, false);
  assert.equal(document.skills.file.release, false);
  assert.equal(document.skills.nerve["skill-creator"], true);

  const reset = applyCapabilityPatch(document, {
    tools: { explore: null },
    skills: {
      file: { release: null },
      nerve: { "skill-creator": null },
    },
  });
  assert.deepEqual(reset, emptyCapabilityOverrides());
});

test("unknown tool keys are rejected but dormant skill names are retained", () => {
  assert.throws(() =>
    capabilityOverridesDocumentSchema.parse({
      schemaVersion: 1,
      tools: { made_up: true },
    }),
  );
  const parsed = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    skills: { file: { "not-installed-here": false } },
  });
  assert.equal(parsed.skills.file["not-installed-here"], false);
  assert.deepEqual(parsed.skills.nerve, {});
});

test("async subagents are one capability across settings, overrides, and harness tools", () => {
  const disabledTools = capabilityToolsFromDisabledNames([
    ...asyncSubagentToolNames,
  ]);
  assert.deepEqual(disabledTools, ["subagents"]);
  const project = applyCapabilityPatch(emptyCapabilityOverrides(), {
    tools: { subagents: true },
  });
  assert.deepEqual(
    resolveCapabilitySelection({ user: { ...user, disabledTools }, project })
      .disabledTools,
    [],
  );
  const conversation = applyCapabilityPatch(emptyCapabilityOverrides(), {
    tools: { subagents: false },
  });
  const selected = resolveCapabilitySelection({
    user: { ...user, disabledTools },
    project,
    conversation,
  });
  assert.deepEqual(disabledToolNamesForCapabilities(selected.disabledTools), [
    ...asyncSubagentToolNames,
  ]);
  assert.equal(
    capabilityPatchSchema.safeParse({ tools: { subagent_new: true } }).success,
    false,
  );
});

test("legacy individual subagent overrides migrate without partially enabling the group", () => {
  const parse = (tools: Record<string, boolean>) =>
    capabilityOverridesDocumentSchema.parse({ schemaVersion: 1, tools }).tools;
  assert.deepEqual(parse({ subagent_new: true }), { subagents: false });
  assert.deepEqual(
    parse(
      Object.fromEntries(asyncSubagentToolNames.map((name) => [name, true])),
    ),
    { subagents: true },
  );
  assert.deepEqual(parse({ subagent_new: true, subagent_stop: false }), {
    subagents: false,
  });
  assert.deepEqual(parse({ subagent_new: false, subagents: true }), {
    subagents: true,
  });
});
