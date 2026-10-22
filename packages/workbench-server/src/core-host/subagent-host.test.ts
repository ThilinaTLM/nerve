import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubagentHost } from "./subagent-host.js";

void test("child preflight uses application defaults, explicit parent identity, and validates the materialized permission", async () => {
  const defaults = {
    model: { provider: "test", modelId: "default" },
    reasoningLevel: "off" as const,
    permissionRuleSetId: "baseline",
    agentProfile: "coding",
    instructions: null,
    systemPrompt: null,
    workingDirectory: "/project",
  };
  const host = createSubagentHost({
    profiles: { usable: async () => [] },
    parent: () => ({
      conversation: {
        id: "parent",
        projectId: "p",
        parentConversationId: null,
      },
      config: { ...defaults, permissionRuleSetId: "planning" },
      projectDir: "/project",
    }),
    applicationDefaults: async () => defaults,
    apply: async (input) => {
      assert.equal(input.config.permissionRuleSetId, "baseline");
      assert.equal(input.conversation.parentConversationId, "parent");
      return {
        config: {
          agentProfile: "developer",
          permissionRuleSetId: "autonomous",
        },
        applied: {
          schemaVersion: 1,
          name: "developer",
          instructions: "Work",
          locked: {},
        },
      };
    },
    validatePermission: async (id) => {
      assert.equal(id, "autonomous");
      throw new Error("Rule set requires user prompts");
    },
  });
  await assert.rejects(
    host.resolveProfile({ parentId: "parent", profile: "developer" }),
    /requires user prompts/,
  );
});
