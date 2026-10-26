import assert from "node:assert/strict";
import test from "node:test";
import { parseOperationParams } from "../../src/operations/catalog.js";

const request = {
  id: "conv_pending",
  projectId: "proj_one",
  title: "Pending",
  config: {
    systemPrompt: null,
    instructions: null,
    workingDirectory: "/project",
  },
};
test("conversation.create preserves sparse choices and never materializes a model or tool defaults", () => {
  const overrides = {
    reasoningLevel: "high",
    tools: {
      python_exec: {
        enabled: false,
        settings: { interpreterPath: "/pending/python" },
      },
      web_search: { profileId: "selected-account" },
    },
    skills: { nerve: { planning: true } },
  };
  assert.deepEqual(
    parseOperationParams("conversation.create", { ...request, overrides })
      .overrides,
    overrides,
  );
  assert.deepEqual(
    parseOperationParams("conversation.create", request),
    request,
  );
  assert.throws(() =>
    parseOperationParams("conversation.create", {
      ...request,
      overrides: { model: { provider: "test" } },
    }),
  );
});
