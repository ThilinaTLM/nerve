import { defaultSettings } from "@nervekit/contracts/settings";
import {
  withTestAdmission,
  withTestPreparation,
  type TestPermissionPort,
} from "./test-admission.js";
import { testConfiguration } from "./configuration-test-helper.js";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { ConversationCore, type ConversationCoreOptions } from "../core.js";
import { openCoreStorage } from "../storage/core-storage.js";
import type {
  ModelPort,
  ToolHostPort,
  TurnResourcesPort,
  TurnPreparationInput,
} from "../ports.js";

export async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for core state");
}
export type TestOptions = Omit<ConversationCoreOptions, "configuration"> & {
  configuration: ReturnType<typeof testConfiguration>;
  permissions: TestPermissionPort;
  turnResources: TurnResourcesPort;
  compactionSettings?(
    id: string,
  ):
    | typeof defaultSettings.compaction
    | Promise<typeof defaultSettings.compaction>;
};
export function options(
  dataDir: string,
  database: string,
  models: ModelPort,
  host: ToolHostPort,
): TestOptions {
  const unexpectedProcess = async (): Promise<never> => {
    throw new Error("No process expected");
  };
  const result: TestOptions = {
    configuration: testConfiguration(
      { prepare: (input) => result.turnResources.prepare(input) },
      (id) => result.storage.conversations.getContext(id)!,
      (id) => result.compactionSettings?.(id) ?? defaultSettings.compaction,
      () => result.defaultConfig("proj_test"),
    ),
    storage: openCoreStorage(database),
    dataDir,
    models,
    toolHost: withTestPreparation(host),
    turnResources: {
      prepare: async () => ({ systemPrompt: "Test", tools: [] }),
    },
    permissions: withTestAdmission(
      {
        evaluate: async ({ toolName }) => ({
          decision: toolName === "write" ? "approval" : "allow",
          suggestedRules: [],
          authority: null,
        }),
        addRule: async () => {},
      },
      (id) => result.configuration.snapshot(id).permissionRuleSetId,
    ),
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
      agentProfile: "coding",
      workingDirectory: dataDir,
    }),
  };
  return result;
}
export async function configureTest(
  opts: TestOptions,
  core: ConversationCore,
  id: string,
  patch: Partial<TurnPreparationInput["config"]>,
) {
  const agentKeys = [
    "model",
    "reasoningLevel",
    "permissionRuleSetId",
    "agentProfile",
  ];
  opts.configuration.update(
    id,
    Object.fromEntries(
      Object.entries(patch).filter(([key]) => agentKeys.includes(key)),
    ),
  );
  const context = Object.fromEntries(
    Object.entries(patch).filter(([key]) => !agentKeys.includes(key)),
  );
  if (Object.keys(context).length) await core.configure(id, context);
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
