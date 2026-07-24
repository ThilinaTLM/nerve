import type { CompletionItem } from "@nervekit/contracts";
import type { OrchestratorState } from "../../app/orchestrator-state.js";
import {
  providerApiKeySecretName,
  providerOAuthSecretName,
} from "../../domains/auth/index.js";
import { listAvailableSkills } from "../../domains/agents/prompting/resource-loader.js";
import { FileCompletionService } from "../../domains/completions/index.js";
import { writeSettings } from "../../infrastructure/storage/index.js";
import { directoryListing } from "../../routes/filesystem-routes.js";
import {
  getConversationSnapshotResponse,
  getWorkspaceSnapshotResponse,
} from "../snapshots.js";
import { defineWorkbenchMethodHandlers } from "../method-handler-registry.js";

const slashCompletionItems: CompletionItem[] = [
  {
    label: "/plan",
    detail: "Start in planning mode",
    info: "Ask the agent to inspect first and produce a short plan before changing files.",
    kind: "slash",
  },
  {
    label: "/code",
    detail: "Switch to implementation",
    info: "Frame the next prompt as a coding task.",
    kind: "slash",
  },
  {
    label: "/status",
    detail: "Summarize current conversation state",
    info: "Useful before handing off or resuming a durable conversation.",
    kind: "slash",
  },
  {
    label: "/abort",
    detail: "Stop the active run",
    info: "Cancels the active agent run from the UI.",
    kind: "slash",
  },
];

export const platformMethodHandlers = defineWorkbenchMethodHandlers({
  "snapshot.workspace.get": (state) => getWorkspaceSnapshotResponse(state),
  "snapshot.conversation.get": (state, params) =>
    getConversationSnapshotResponse(state, params.conversationId),
  "settings.get": (state) => state.storage.settings,
  "settings.update": (state, params) =>
    updateSettings(state, params as Record<string, unknown>),
  "skill.list": (state, params) => {
    const projectDir = params?.projectId
      ? state.registry.getProject(params.projectId).dir
      : undefined;
    return listAvailableSkills(projectDir, {
      storageHome: state.storage.paths.home,
      agentBrowserSkills: state.agentBrowserSkills.skills,
    });
  },
  "auth.providers.list": async (state) => ({
    providers: await state.auth.listProviderMetadata(
      state.registry.listModels(),
      state.providerCatalog.providerDisplayNames(),
    ),
  }),
  "providerCatalog.get": async (state) => {
    await state.providerCatalog.ensureLoaded();
    return state.providerCatalog.catalog;
  },
  "providerCatalog.custom.upsert": async (state, params) => {
    const catalog = await state.providerCatalog.upsertProvider(params as never);
    await publishProviderCatalogChanged(state, params.id);
    return catalog;
  },
  "providerCatalog.custom.delete": async (state, params) => {
    const catalog = await state.providerCatalog.deleteProvider(params.id);
    await state.secrets.delete(providerApiKeySecretName(params.id));
    await state.secrets.delete(providerOAuthSecretName(params.id));
    await publishProviderCatalogChanged(state, params.id);
    return catalog;
  },
  "providerCatalog.model.upsert": async (state, params) => {
    const catalog = await state.providerCatalog.upsertModel(params as never);
    await publishProviderCatalogChanged(state, params.provider);
    return catalog;
  },
  "providerCatalog.model.delete": async (state, params) => {
    const catalog = await state.providerCatalog.deleteModel(
      params.provider,
      params.modelId,
    );
    await publishProviderCatalogChanged(state, params.provider);
    return catalog;
  },
  "storage.info": (state) => ({
    dataDir: state.storage.paths.home,
    sqlitePath: state.storage.paths.sqlitePath,
    configPath: state.storage.paths.configPath,
    counts: state.index.counts(),
  }),
  "storage.rebuildIndex": async (state) => {
    await state.registry.rebuildIndex();
    return { ok: true, counts: state.index.counts() };
  },
  "storage.usage.get": (state) => state.storageUsage.computeUsage(),
  "storage.cleanup": async (state, params) => ({
    operation: await state.storageCleanup.start(params),
  }),
  "storage.cleanup.get": (state, params) => ({
    operation: state.storageCleanup.get(params?.operationId),
  }),
  "storage.cleanup.cancel": async (state, params) => ({
    operation: await state.storageCleanup.cancel(params.operationId),
  }),
  "model.list": (state) => ({ models: state.registry.listModels() }),
  "usage.subscription.get": async (state) => ({
    usage: await state.registry.getSubscriptionUsage(),
  }),
  "completion.slash.list": () => ({ items: slashCompletionItems }),
  "completion.files.list": async (state, params) => {
    const files = new FileCompletionService((projectId) =>
      state.registry.getProject(projectId),
    );
    return {
      items: await files.completeFiles(params?.projectId, params?.q ?? "", {
        limit: params?.limit as number | undefined,
      }),
    };
  },
  "filesystem.directories.list": (_state, params) =>
    directoryListing(params?.path, params?.showHidden as boolean | undefined),
  "applicationLog.prune": (state, params) => state.logger.prune(params),
});

async function updateSettings(
  state: OrchestratorState,
  patch: Record<string, unknown>,
) {
  const settings = await writeSettings(state.storage, patch as never);
  if (
    patch.runtime &&
    typeof patch.runtime === "object" &&
    "pythonExecutablePath" in patch.runtime
  ) {
    await state.registry.pythonRuntime.refresh();
  }
  await state.events.publish("settings.updated", { settings });
  return { settings };
}

async function publishProviderCatalogChanged(
  state: OrchestratorState,
  provider?: string,
): Promise<void> {
  await state.events.publish("providers.catalog_changed", { provider });
  await state.events.publish("auth.providers_changed", { provider });
}
