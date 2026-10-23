import { testConfiguration } from "./configuration-test-helper.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import type { AgentConfigurationPort } from "../configuration.js";
import type { PiModel } from "../ports.js";
import { ModelTurn, StaleRequestCaptureError } from "./model-turn.js";

const config: ConversationConfig = {
  conversationId: "conv_snapshot",
  model: { provider: "obsolete-sql", modelId: "obsolete-sql" },
  reasoningLevel: "off",
  agentProfile: "coding",
  systemPrompt: null,
  instructions: null,
  permissionRuleSetId: "baseline",
  workingDirectory: "/tmp",
};
const input = () => ({
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

void test("request preparation uses scoped authority, owns captures and retries stale asynchronous model resolution", async () => {
  let generation = 1;
  let captures = 0;
  const tool = {
    ...toolDefinitionByName("bash")!,
    parameters: structuredClone(toolDefinitionByName("bash")!.parameters),
  };
  const configuration: AgentConfigurationPort = {
    ...testConfiguration({
      prepare: async () => ({ systemPrompt: "Test", tools: [] }),
    }),
    async initializeConversation() {},
    async capturePreview() {
      throw new Error("Not used");
    },
    async captureRequest() {
      const captured = generation;
      captures++;
      return {
        id: `capture-${captured}`,
        model: { provider: "scoped", modelId: `model-${captured}` },
        reasoningLevel: "high",
        agentProfile: "planning",
        systemPrompt: `prompt-${captured}`,
        tools: [tool],
        isCurrent: () => captured === generation,
      };
    },
    async captureCompaction() {
      throw new Error("Not used");
    },
    async captureRetry() {
      throw new Error("Not used");
    },
  };
  const resolutions: string[] = [];
  const turn = new ModelTurn(
    {
      async resolve(selection) {
        resolutions.push(selection.modelId);
        const model = {
          id: selection.modelId,
          contextWindow: 100_000,
        } as PiModel;
        selection.modelId = "mutated argument";
        if (generation === 1) generation++;
        return { model };
      },
    },
    configuration,
    () => [],
    () => {},
  );
  const prepared = await turn.prepareRequest(input());
  assert.equal(captures, 2);
  assert.deepEqual(resolutions, ["model-1", "model-2"]);
  assert.equal(prepared.requestCaptureId, "capture-2");
  assert.equal(prepared.model.modelId, "model-2");
  assert.equal(prepared.reasoning, "high");
  assert.equal(prepared.systemPrompt, "prompt-2");
  tool.description = "changed after publication";
  tool.parameters = {} as typeof tool.parameters;
  assert.notEqual(prepared.tools[0]!.description, tool.description);
  assert.notDeepEqual(prepared.tools[0]!.parameters, tool.parameters);
  generation++;
  await assert.rejects(
    turn.runPrepared(input(), prepared),
    StaleRequestCaptureError,
  );
  assert.equal(prepared.model.modelId, "model-2");
  const next = await turn.prepareRequest(input());
  assert.equal(next.model.modelId, "model-3");
});
