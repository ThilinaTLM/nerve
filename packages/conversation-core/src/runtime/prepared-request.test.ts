import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import type { PiModel } from "../ports.js";
import { ModelTurn } from "./model-turn.js";

void test("preparation owns config, resolution and schemas despite mutations in host callbacks", async () => {
  const config: ConversationConfig = {
    conversationId: "conv_snapshot",
    model: { provider: "test", modelId: "original" },
    reasoningLevel: "high",
    agentProfile: "planning",
    systemPrompt: "Custom prompt",
    instructions: "Original",
    permissionRuleSetId: "baseline",
    workingDirectory: "/tmp",
  };
  const model = { id: "original", contextWindow: 100_000 } as PiModel;
  const definition = toolDefinitionByName("bash")!;
  const tool = {
    ...definition,
    parameters: structuredClone(definition.parameters),
  };
  const originalSchema = structuredClone(tool.parameters);
  const turn = new ModelTurn(
    {
      resolve: async (selection) => {
        selection.modelId = "mutated selection";
        config.reasoningLevel = "off";
        config.agentProfile = "coding";
        config.systemPrompt = "Changed outside preparation";
        return { model, headers: { revision: "original" } };
      },
    },
    {
      prepare: async (input) => {
        assert.equal(input.config.model.modelId, "original");
        assert.equal(input.config.reasoningLevel, "high");
        input.config.reasoningLevel = "low";
        input.config.agentProfile = "coding";
        input.config.systemPrompt = "Changed by adapter";
        model.contextWindow = 10;
        return { systemPrompt: "Generated prompt", tools: [tool] };
      },
    },
    () => [],
    () => {},
  );
  const prepared = await turn.prepareRequest({
    conversation: {
      id: "conv_snapshot",
      projectId: "project",
      parentConversationId: null,
    } as Parameters<ModelTurn["run"]>[0]["conversation"],
    config,
    projectDir: "/tmp",
    path: [],
    turnId: "turn_snapshot",
    signal: new AbortController().signal,
  });
  tool.description = "Changed after preparation";
  tool.parameters = {} as typeof tool.parameters;
  assert.equal(prepared.resolved.model.contextWindow, 100_000);
  assert.equal(prepared.reasoning, "high");
  assert.equal(prepared.agentProfile, "planning");
  assert.equal(prepared.systemPrompt, "Custom prompt");
  assert.notEqual(prepared.tools[0]!.description, tool.description);
  assert.deepEqual(prepared.tools[0]!.parameters, originalSchema);
});
