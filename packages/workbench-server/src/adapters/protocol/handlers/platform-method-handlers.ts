import {
  createDirectory,
  getFilesystemLocations,
} from "../../../domains/filesystem/filesystem-browser.js";
import { type UpdateApplicationConfigurationRequest } from "@nervekit/contracts/settings";
import {
  providerApiKeySecretName,
  providerOAuthSecretName,
} from "../../../domains/auth/index.js";
import {
  createProjectEntry,
  directoryListing,
  projectDirectoryEntries,
} from "../../../domains/filesystem/filesystem.service.js";
import {
  copyProjectEntry,
  deleteProjectEntries,
  moveProjectEntry,
} from "../../../domains/filesystem/project-entry-mutations.js";
import {
  projectPathIndexes,
  searchProjectContent,
} from "../../../domains/filesystem/project-path-index.js";
import {
  assertApplicationConfigurationEditable,
  resolveApplicationConfiguration,
} from "../../../infrastructure/configuration/index.js";
import {
  publishSettingsChanged,
  publishProviderCatalogChanged as notifyProviderCatalogChanged,
} from "../../../infrastructure/configuration/settings-notifications.js";
import { writeSettings } from "../../../infrastructure/storage-bootstrap/index.js";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../contexts.js";

type PlatformMethodContext = ServerAdapterContexts["protocol"]["platform"];
const definePlatformMethodHandlers =
  defineWorkbenchMethodHandlersFor<PlatformMethodContext>();

export const platformMethodHandlers: WorkbenchMethodHandlerMapFor<PlatformMethodContext> =
  definePlatformMethodHandlers({
    "status.latestRelease.get": (state) =>
      state.latestRelease.getLatestRelease(),
    "conversationTitles.test": (state) => state.conversationTitles.test(),
    "settings.get": (state) => state.storage.settings,
    "settings.update": (state, params) =>
      updateSettings(state, params as Record<string, unknown>),
    "applicationConfiguration.get": (state) => state.applicationConfiguration,
    "applicationConfiguration.update": (state, params) =>
      updateApplicationConfiguration(state, params),
    "auth.providers.list": async (state) => ({
      providers: await state.auth.listProviderMetadata(
        state.providerCatalog.providerDisplayNames(),
      ),
    }),
    "accounts.list": async (state) => ({
      accounts: await state.accounts.views(),
      kinds: [...state.accounts.kinds()],
    }),
    "accounts.save": async (state, params) => {
      const { secret, ...input } = params;
      // Decrypt first, so a stale key fails before anything is written.
      const plaintext = secret
        ? state.credentialKey.decryptEnvelope(secret)
        : undefined;
      const saved = await state.accounts.save(input);
      if (plaintext)
        await state.accounts.setSecret(saved.kind, saved.id, plaintext);
      await state.events.publish("accounts.changed", {
        kind: saved.kind,
        accountId: saved.id,
      });
      return { account: (await state.accounts.view(saved.kind, saved.id))! };
    },
    "accounts.delete": async (state, params) => {
      const deleted = await state.accounts.delete(params.kind, params.id);
      if (deleted)
        await state.events.publish("accounts.changed", {
          kind: params.kind,
          accountId: params.id,
        });
      return { deleted };
    },
    "accounts.health.list": async (state) => ({
      health: await state.integrationHealth.list(),
    }),
    "accounts.test": async (state, params) => ({
      health: await state.integrationHealth.check(params.kind, params.id),
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
      counts: {
        projects: state.conversationCore.projects.list().length,
        conversations: 0,
        entries: 0,
        launches: 0,
      },
    }),
    "storage.usage.get": (state) => state.storageUsage.computeUsage(),
    "storage.cleanup": async (state, parameters) => ({
      operation: await state.maintenance.start({
        kind: "storage_cleanup",
        parameters,
      }),
    }),
    "maintenance.get": (state) => ({ operation: state.maintenance.get() }),
    "maintenance.cancel": async (state, params) => ({
      operation: await state.maintenance.cancel(params.operationId),
    }),
    "usage.subscription.get": async (state) => ({
      usage: await state.subscriptionUsage.getSnapshots({ refresh: true }),
    }),
    "filesystem.locations.get": () => getFilesystemLocations(),
    "filesystem.directories.create": (_state, params) =>
      createDirectory(params.parent, params.name),
    "filesystem.directories.list": (_state, params) =>
      directoryListing(params?.path, params?.showHidden as boolean | undefined),
    "filesystem.project.entries.list": (state, params) =>
      projectDirectoryEntries(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "filesystem.project.monitor.sync": async (state, params, invocation) => {
      const project = requireProject(state, params.projectId);
      return state.workspaceMonitor.syncProject(
        monitorOwner(invocation.monitorOwner),
        project.id,
        project.directory,
        params.directories,
      );
    },
    "filesystem.project.monitor.clear": async (state, params, invocation) => {
      await state.workspaceMonitor.clearProject(
        monitorOwner(invocation.monitorOwner),
        params.projectId,
      );
      return { active: false, degraded: false, watchedDirectoryCount: 0 };
    },
    "filesystem.project.refresh": (state, params) =>
      state.workspaceMonitor.requestProjectRefresh(params.projectId),
    "filesystem.project.entries.create": (state, params) =>
      createProjectEntry(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "filesystem.project.entries.move": (state, params) =>
      moveProjectEntry(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "filesystem.project.entries.copy": (state, params) =>
      copyProjectEntry(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "filesystem.project.entries.delete": (state, params) =>
      deleteProjectEntries(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "filesystem.project.paths.search": (state, params) =>
      projectPathIndexes.search(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "filesystem.project.content.search": (state, params) =>
      searchProjectContent(
        params,
        (projectId) => requireProject(state, projectId).directory,
      ),
    "applicationLog.prune": (state, params) => state.logger.prune(params),
  });

function monitorOwner(owner: string | undefined): string {
  if (!owner)
    throw new Error("Filesystem monitoring requires a live protocol session");
  return owner;
}

async function updateSettings(
  state: PlatformMethodContext,
  patch: Record<string, unknown>,
) {
  if (patch.application) {
    assertApplicationConfigurationEditable(
      state.applicationConfiguration,
      patch,
    );
  }
  const settings = await writeSettings(state.storage, patch);
  await publishSettingsChanged(state.events, settings);
  return { settings };
}

async function updateApplicationConfiguration(
  state: PlatformMethodContext,
  patch: UpdateApplicationConfigurationRequest,
) {
  assertApplicationConfigurationEditable(state.applicationConfiguration, patch);
  const settings = await writeSettings(state.storage, (current) =>
    normalizeRemoteAccessPatch(current.application.network.host, patch),
  );
  const resolved = resolveApplicationConfiguration({
    settings,
    env: process.env,
    argv: process.argv.slice(2),
    dataDir: state.storage.paths.home,
    activeSnapshot: state.applicationConfiguration,
  });
  state.applicationConfiguration = resolved.snapshot;
  await publishSettingsChanged(state.events, settings);
  await state.events.publish("applicationConfiguration.updated", {
    snapshot: resolved.snapshot,
  });
  return resolved.snapshot;
}

function normalizeRemoteAccessPatch(
  host: string,
  patch: UpdateApplicationConfigurationRequest,
): UpdateApplicationConfigurationRequest {
  const allowRemote = patch.application?.network?.allowRemote;
  if (
    allowRemote === undefined ||
    patch.application?.network?.host !== undefined
  ) {
    return patch;
  }
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
  provider: string,
): Promise<void> {
  await notifyProviderCatalogChanged(state.events, provider);
}

function requireProject(state: PlatformMethodContext, id: string) {
  const project = state.conversationCore.projects.get(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  return project;
}
