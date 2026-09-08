import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCapabilityPatch,
  capabilityOverridesDocumentSchema,
  emptyCapabilityOverrides,
  resolveCapabilitySelection,
} from "../../src/domains/capabilities/capabilities.js";

const user = {
  disabledTools: ["python_exec" as const],
  disabledFileSkills: ["release"],
  enabledAgentBrowserSkills: ["core"],
};

test("capability selection composes user, project, and conversation scopes", () => {
  const project = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { python_exec: true, web_search: false },
    skills: {
      file: { release: true, deploy: false },
      agentBrowser: { core: false, browser: true },
    },
  });
  const conversation = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { web_search: true },
    skills: {
      file: { deploy: true },
      agentBrowser: { browser: false },
    },
  });

  assert.deepEqual(
    resolveCapabilitySelection({ user, project, conversation }),
    {
      disabledTools: [],
      disabledFileSkills: [],
      enabledAgentBrowserSkills: [],
    },
  );
});

test("missing entries inherit and null patches remove an override", () => {
  const document = applyCapabilityPatch(emptyCapabilityOverrides(), {
    tools: { explore: false },
    skills: { file: { release: false } },
  });
  assert.equal(document.tools.explore, false);
  assert.equal(document.skills.file.release, false);

  const reset = applyCapabilityPatch(document, {
    tools: { explore: null },
    skills: { file: { release: null } },
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
});
