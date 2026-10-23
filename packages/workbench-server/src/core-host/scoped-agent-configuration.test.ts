import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { createScopedAgentConfiguration } from "./scoped-agent-configuration.js";

void test("request captures retry changed generations and retain advertised executor/account settings", async () => {
  let version = 1;
  let preparations = 0;
  const accounts = { account: { id: "account", endpoint: "original" } };
  const service = {
    async captureEffective() {
      const generation = version;
      return {
        view: {
          status: "available",
          role: "lead",
          sources: [],
          resolution: resolveAgentConfiguration({
            role: "lead",
            user: {
              model: { provider: "test", modelId: `model-${version}` },
              tools: {
                python_exec: {
                  settings: { interpreterPath: `/python-${version}` },
                },
              },
            },
          }),
        },
        isCurrent: () => generation === version,
      };
    },
  } as unknown as AgentConfigurationService;
  const configuration = createScopedAgentConfiguration({
    service,
    profiles: {
      preview: async () => {
        throw new Error("Unused");
      },
      apply: async () => {
        throw new Error("Unused");
      },
      reconcile: async () => {
        throw new Error("Unused");
      },
      reject: async () => {
        throw new Error("Unused");
      },
    },
    prepareCreation: async () => {
      throw new Error("Unused");
    },
    initializeConversation: async () => {},
    captureExecutorResources: () => accounts,
    resourcesGeneration: () => version,
    prepare: async () => {
      preparations++;
      if (preparations === 1) version++;
      return { systemPrompt: `prompt-${version}`, tools: [] };
    },
  });
  const input = {
    conversation: { id: "lead", projectId: "p", parentConversationId: null },
    config: {
      model: { provider: "obsolete", modelId: "obsolete" },
      reasoningLevel: "off" as const,
      agentProfile: "coding",
      permissionRuleSetId: "baseline",
      systemPrompt: null,
      instructions: null,
      workingDirectory: "/project",
    },
    projectDir: "/project",
    coreTools: [],
  };
  const first = await configuration.port.captureRequest(input);
  assert.equal(preparations, 2);
  assert.equal(first.model.modelId, "model-2");
  accounts.account.endpoint = "changed";
  version++;
  const next = await configuration.port.captureRequest(input);
  assert.equal(next.model.modelId, "model-3");
  assert.notEqual(next.id, first.id);
  const capture = configuration.getCapture(first.id)!;
  assert.equal(
    capture.settings.tools?.python_exec?.settings?.interpreterPath,
    "/python-2",
  );
  assert.deepEqual(capture.executorResources, {
    account: { id: "account", endpoint: "original" },
  });
  capture.settings.model!.modelId = "caller-mutated";
  assert.equal(
    configuration.getCapture(first.id)!.settings.model?.modelId,
    "model-2",
  );
  const cancelled = new AbortController();
  cancelled.abort(new Error("Cancelled capture"));
  const beforeCancellation = preparations;
  await assert.rejects(
    configuration.port.captureRequest({ ...input, signal: cancelled.signal }),
    /Cancelled capture/,
  );
  assert.equal(preparations, beforeCancellation);
  configuration.releaseCapture(first.id);
  assert.equal(configuration.getCapture(first.id), undefined);
});
