import assert from "node:assert/strict";
import test from "node:test";
import { parseOperationParams } from "../../src/operations/catalog.js";

const request = {
  id: "conv_pending",
  projectId: "proj_one",
  title: "Pending",
  config: {
    model: { provider: "test", modelId: "selected" },
    reasoningLevel: "high",
    systemPrompt: null,
    instructions: null,
    permissionRuleSetId: "autonomous",
    workingDirectory: "/project",
  },
};
test("conversation.create preserves typed v3 initial capabilities and rejects unmigrated documents", () => {
  const capabilityOverrides = {
    schemaVersion: 3,
    tools: {
      python_exec: {
        enabled: true,
        settings: { interpreterPath: "/pending/python" },
      },
      web_search: { enabled: true, profileId: "selected-account" },
    },
    skills: { file: {}, nerve: { planning: true }, agentBrowser: {} },
  };
  assert.deepEqual(
    parseOperationParams("conversation.create", {
      ...request,
      capabilityOverrides,
    }).capabilityOverrides,
    capabilityOverrides,
  );
  assert.throws(() =>
    parseOperationParams("conversation.create", {
      ...request,
      capabilityOverrides: { schemaVersion: 2, tools: {} },
    }),
  );
  assert.equal(
    parseOperationParams("conversation.create", request).capabilityOverrides,
    undefined,
  );
});
