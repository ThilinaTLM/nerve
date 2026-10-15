import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { ConversationCore, type ConversationCoreOptions } from "../core.js";
import { openCoreStorage } from "../storage/core-storage.js";
import type { ModelPort, ToolHostPort } from "../ports.js";

export async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for core state");
}
export function options(
  dataDir: string,
  database: string,
  models: ModelPort,
  host: ToolHostPort,
): ConversationCoreOptions {
  const unexpectedProcess = async (): Promise<never> => {
    throw new Error("No process expected");
  };
  return {
    storage: openCoreStorage(database),
    dataDir,
    models,
    toolHost: host,
    turnResources: {
      prepare: async () => ({ systemPrompt: "Test", tools: [] }),
    },
    permissions: {
      evaluate: async ({ toolName }) => ({
        decision: toolName === "write" ? "approval" : "allow",
        suggestedRules: [],
        authority: null,
      }),
      addRule: async () => {},
    },
    processes: {
      start: unexpectedProcess,
      run: unexpectedProcess,
      reattach: async () => null,
    },
    defaultConfig: () => ({
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "baseline",
      mode: "coding",

      workingDirectory: dataDir,
    }),
  };
}
export async function createConversation(core: ConversationCore, id: string) {
  if (!core.projects.get("proj_test"))
    core.projects.create({
      id: "proj_test",
      name: "Test",
      directory: tmpdir(),
    });
  await core.createConversation({ id, projectId: "proj_test" });
}
