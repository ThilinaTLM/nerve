import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { createScopedAgentConfiguration } from "./scoped-agent-configuration.js";

void test("request captures retry changed generations and retain advertised executor/account settings", async () => {
  let version = 1;
  let preparations = 0;
  let workingDirectory = "/project";
  const accounts = { account: { id: "account", endpoint: "original" } };
  const service = {
    async captureEffective() {
      const generation = version;
      return {
        view: {
          status: "available",
          role: "lead",
          sources: [
            {
              scope: { scope: "conversation", conversationId: "lead" },
              path: "/lead/agent.json",
              generation,
              document: {
                schemaVersion: 1,
                revision: 0,
                overrides: {},
                appliedProfile: null,
                context: {
                  instructions: `json-${version}`,
                  systemPrompt: "JSON base",
                },
              },
            },
          ],
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
    workingDirectory: () => workingDirectory,
    service,
    profiles: {
      preview: async () => {
        throw new Error("Unused");
      },
      apply: async () => {
        throw new Error("Unused");
      },
    },
    prepareCreation: async () => {
      throw new Error("Unused");
    },
    initializeConversation: async () => {},
    captureExecutorResources: () => accounts,
    resourcesGeneration: () => version,
    prepare: async (input) => {
      assert.equal(input.config.instructions, `json-${version}`);
      assert.equal(input.config.systemPrompt, "JSON base");
      assert.equal(input.config.workingDirectory, workingDirectory);
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
  workingDirectory = "/moved";
  assert.equal(
    first.isCurrent(),
    false,
    "SQL-only directory edits invalidate advertised prompt captures",
  );
  await configuration.port.captureRequest(input);
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

void test("execution resolves service authority and never falls back to a populated display cache", async () => {
  let available = false;
  const cached = {
    model: { provider: "cached", modelId: "stale" },
    observedDigest: "0".repeat(64),
  };
  const service = {
    getSummary: () => cached,
    async getEffective() {
      return available
        ? {
            status: "available",
            sources: [
              {
                scope: {
                  scope: "conversation",
                  conversationId: "conversation",
                },
                path: "/conversation/agent.json",
                generation: 1,
                document: {
                  schemaVersion: 1,
                  revision: 0,
                  overrides: {},
                  appliedProfile: null,
                  context: {
                    instructions: "JSON context",
                    systemPrompt: "JSON base",
                  },
                },
              },
            ],
            resolution: resolveAgentConfiguration({
              role: "lead",
              user: { model: { provider: "real", modelId: "current" } },
            }),
          }
        : { status: "unavailable", diagnostics: [] };
    },
  } as unknown as AgentConfigurationService;
  const unused = async (): Promise<never> => {
    throw new Error("unused");
  };
  const configuration = createScopedAgentConfiguration({
    workingDirectory: () => "/project",
    service,
    profiles: {
      preview: unused,
      apply: unused,
    },
    prepareCreation: unused,
    initializeConversation: async () => {},
    captureExecutorResources: () => ({}),
    resourcesGeneration: () => 0,
    prepare: async () => ({ systemPrompt: "", tools: [] }),
  });
  const context = {
    systemPrompt: "exact prompt",
    instructions: "exact context",
    workingDirectory: "/project",
  };
  assert.deepEqual(configuration.port.summary?.("conversation"), {
    model: cached.model,
  });
  await assert.rejects(
    configuration.port.resolveConfig("conversation", context),
    /unavailable/,
  );
  available = true;
  const resolved = await configuration.port.resolveConfig(
    "conversation",
    context,
  );
  assert.deepEqual(resolved.model, { provider: "real", modelId: "current" });
  assert.equal(resolved.instructions, "JSON context");
  assert.equal(resolved.systemPrompt, "JSON base");
  assert.equal(resolved.workingDirectory, context.workingDirectory);
});
