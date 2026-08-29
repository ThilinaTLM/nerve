import { slashCommandCompletionItems } from "@nervekit/contracts/completions";
import { type UpdateApplicationConfigurationRequest } from "@nervekit/contracts/settings";
import {
  providerApiKeySecretName,
  providerOAuthSecretName,
} from "../../../domains/auth/index.js";
import { listAvailableSkills } from "../../../domains/agents/prompting/resource-loader.js";
import {
  createProjectEntry,
  directoryListing,
  projectDirectoryEntries,
} from "../../../domains/filesystem/filesystem.service.js";
import {
  assertApplicationConfigurationEditable,
  resolveApplicationConfiguration,
} from "../../../infrastructure/configuration/index.js";
import { writeSettings } from "../../../infrastructure/storage-bootstrap/index.js";
import {
  getConversationSnapshotResponse,
  getWorkspaceSnapshotResponse,
} from "../snapshots.js";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
  type WorkbenchOperationContext,
} from "../method-handler-registry.js";

type PlatformMethodContext = Pick<
  WorkbenchOperationContext,
  | "agentBrowserSkills"
  | "applicationConfiguration"
  | "auth"
  | "events"
  | "latestRelease"
  | "logger"
  | "providerCatalog"
  | "queryCache"
  | "registry"
  | "secrets"
  | "storage"
  | "storageCleanup"
  | "storageUsage"
>;
const definePlatformMethodHandlers =
  defineWorkbenchMethodHandlersFor<PlatformMethodContext>();

export const platformMethodHandlers: WorkbenchMethodHandlerMapFor<PlatformMethodContext> =
  definePlatformMethodHandlers({
    "status.latestRelease.get": (state) =>
      state.latestRelease.getLatestRelease(),
    "snapshot.workspace.get": (state) => getWorkspaceSnapshotResponse(state),
    "snapshot.conversation.get": (state, params) =>
      getConversationSnapshotResponse(state, params.conversationId),
    "settings.get": (state) => state.storage.settings,
    "settings.update": (state, params) =>
      updateSettings(state, params as Record<string, unknown>),
    "applicationConfiguration.get": (state) => state.applicationConfiguration,
    "applicationConfiguration.update": (state, params) =>
      updateApplicationConfiguration(state, params),
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
        state.providerCatalog.providerDisplayNames(),
      ),
    }),
    "providerCatalog.get": async (state) => {
      await state.providerCatalog.ensureLoaded();
      return state.providerCatalog.catalog;
    },
    "providerCatalog.custom.upsert": async (state, params) => {
      const catalog = await state.providerCatalog.upsertProvider(
        params as never,
      );
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
      counts: state.queryCache.counts(),
    }),
    "storage.rebuildIndex": async (state) => {
      await state.registry.rebuildIndex();
      return { ok: true, counts: state.queryCache.counts() };
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
    "completion.slash.list": () => ({
      items: [...slashCommandCompletionItems],
    }),
    "completion.files.list": async (state, params) => ({
      items: await state.registry.completeFiles(
        params?.projectId,
        params?.q ?? "",
        { limit: params?.limit as number | undefined },
      ),
    }),
    "filesystem.directories.list": (_state, params) =>
      directoryListing(params?.path, params?.showHidden as boolean | undefined),
    "filesystem.project.entries.list": (state, params) => {
      state.registry.watchProjectFilesystem(params.projectId);
      return projectDirectoryEntries(
        params,
        (projectId) => state.registry.getProject(projectId).dir,
      );
    },
    "filesystem.project.entries.create": (state, params) =>
      createProjectEntry(
        params,
        (projectId) => state.registry.getProject(projectId).dir,
      ),
    "applicationLog.prune": (state, params) => state.logger.prune(params),
  });

async function updateSettings(
  state: PlatformMethodContext,
  patch: Record<string, unknown>,
) {
  if (patch.application) {
    assertApplicationConfigurationEditable(
      state.applicationConfiguration,
      patch as UpdateApplicationConfigurationRequest,
    );
  }
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

async function updateApplicationConfiguration(
  state: PlatformMethodContext,
  patch: UpdateApplicationConfigurationRequest,
) {
  assertApplicationConfigurationEditable(state.applicationConfiguration, patch);
  const normalized = normalizeRemoteAccessPatch(state, patch);
  const settings = await writeSettings(state.storage, normalized);
  const resolved = resolveApplicationConfiguration({
    settings,
    env: process.env,
    argv: process.argv.slice(2),
    dataDir: state.storage.paths.home,
    activeSnapshot: state.applicationConfiguration,
  });
  state.applicationConfiguration = resolved.snapshot;
  await state.events.publish("settings.updated", { settings });
  await state.events.publish("applicationConfiguration.updated", {
    snapshot: resolved.snapshot,
  });
  return resolved.snapshot;
}

function normalizeRemoteAccessPatch(
  state: PlatformMethodContext,
  patch: UpdateApplicationConfigurationRequest,
): UpdateApplicationConfigurationRequest {
  const allowRemote = patch.application?.network?.allowRemote;
  if (
    allowRemote === undefined ||
    patch.application?.network?.host !== undefined
  ) {
    return patch;
  }
  const host = state.storage.settings.application.network.host;
  const nextHost = allowRemote
    ? host === "127.0.0.1" || host === "localhost"
      ? "0.0.0.0"
      : host
    : host === "0.0.0.0" || host === "::"
      ? "127.0.0.1"
      : host;
  return {
    ...patch,
    application: {
      ...patch.application,
      network: { ...patch.application?.network, host: nextHost },
    },
  };
}

async function publishProviderCatalogChanged(
  state: PlatformMethodContext,
  provider?: string,
): Promise<void> {
  await state.events.publish("providers.catalog_changed", { provider });
  await state.events.publish("auth.providers_changed", { provider });
}
