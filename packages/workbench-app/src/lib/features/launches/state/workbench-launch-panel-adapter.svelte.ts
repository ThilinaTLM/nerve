import type { Project } from "@nervekit/contracts/core";
import { untrack } from "svelte";
import type {
  StartLaunchRequest,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type { CancelLaunchRequest } from "@nervekit/contracts/launches";
import type {
  LaunchDefinition,
  CreateLaunchDefinitionRequest,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { launchState } from "$lib/features/launches/state/launch-state.svelte";
import {
  setLaunchEntryRun,
  launchEntryKey,
} from "$lib/features/launches/state/launch-tabs.svelte";
import { refreshWorkbenchLaunches } from "./launch-events";
import { launchConfigurationBlocked } from "./launch-configuration-blocked.svelte";
import {
  getLaunchLogs,
  startLaunchDefinition,
  createLaunchFolder,
  renameLaunchFolder,
  deleteLaunchFolder,
  moveLaunchCatalogEntry,
  createLaunchDefinition,
  deleteLaunchDefinition,
  updateLaunchDefinition,
} from "$lib/features/launches/api/launches.api";
import {
  cachedLaunchDefinitions,
  loadLaunchDefinitions,
  cachedLaunchCatalog,
  launchCatalogError,
  invalidateLaunchCatalog,
} from "$lib/features/launches/state/launch-definitions.svelte";
import { createLaunchDefinitionRevalidationGate } from "$lib/features/launches/state/launch-definition-revalidation";
import {
  disabledCapability,
  enabledCapability,
} from "$lib/domain/capabilities/feature-capability";
import {
  createLaunchPanelActions,
  normalizeLaunchDefinition,
} from "$lib/features/launches/views/launch-panel-controller";
import type {
  LaunchPanelActions,
  LaunchPanelDefinition,
  LaunchPanelModel,
} from "$lib/features/launches/views/launch-panel-types";

export type WorkbenchLaunchPanelHostActions = {
  readonly openLaunchOutput?: (id: string) => void;
  readonly cancelLaunch?: (id: string, request?: CancelLaunchRequest) => void;
  readonly restartLaunch?: (id: string) => void;
  readonly removeLaunch?: (id: string) => void;
  readonly cleanupRuns?: (ids: readonly string[]) => void;
  readonly pruneLaunches?: () => void;
  readonly runCommand?: (input: {
    projectId: string;
    cwd: string;
    command: string;
    name?: string;
  }) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkbenchLaunchPanelAdapter(
  activeProject: () => Project | undefined,
  launches: () => readonly LaunchRecord[],
  selectedLaunch: () => LaunchRecord | undefined,
  hostActions: WorkbenchLaunchPanelHostActions,
): { readonly model: LaunchPanelModel; readonly actions: LaunchPanelActions } {
  let loadingDefinitions = $state(false);
  let startGeneration = 0;
  let runningDefinition = $state<
    { projectId: string; id: string; generation: number } | undefined
  >(undefined);
  let portConflict = $state<LaunchPanelModel["portConflict"]>(undefined);
  const definitionRevalidation = createLaunchDefinitionRevalidationGate();
  const definitions = $derived(
    cachedLaunchDefinitions(activeProject()?.id) ?? [],
  );

  const unavailable = (message: string) => disabledCapability(message);
  const adapter = {
    get model(): LaunchPanelModel {
      const project = activeProject();
      const noRunner = unavailable(
        "Launch execution is unavailable in this host.",
      );
      const noAction = unavailable(
        "This launch operation is unavailable in this host.",
      );
      const catalog = cachedLaunchCatalog(project?.id);
      const catalogError = launchCatalogError(project?.id);
      const configurationBlocked = launchConfigurationBlocked(project?.id);
      const action = configurationBlocked
        ? unavailable("Launch definitions are unavailable until repaired.")
        : project && catalog && !catalogError
          ? enabledCapability
          : unavailable(catalogError ?? "Wait for a valid launch catalog.");
      return {
        availability: project
          ? { available: true }
          : {
              available: false,
              message: "Select a project to manage its launches.",
            },
        launches: launches(),
        selectedLaunch: selectedLaunch(),
        selectedLogs: launchState.launchLogs,
        logsLoading: false,
        projectId: project?.id,
        folders: catalog?.folders ?? [],
        catalogRevision: catalogError ? undefined : catalog?.revision,
        catalogError,
        configurationBlocked,
        definitions: definitions.map(normalizeLaunchDefinition),
        defaultCwd: project?.directory ?? "",
        definitionsLoading: loadingDefinitions,
        runningDefinitionId:
          runningDefinition?.projectId === project?.id
            ? runningDefinition?.id
            : undefined,
        portConflict:
          portConflict?.definition.scope.projectId === project?.id
            ? portConflict
            : undefined,
        capabilities: {
          start:
            project && hostActions.runCommand ? enabledCapability : noRunner,
          cancel:
            project && hostActions.cancelLaunch ? enabledCapability : noAction,
          restart:
            project && hostActions.restartLaunch ? enabledCapability : noAction,
          remove:
            project && hostActions.removeLaunch ? enabledCapability : noAction,
          prune:
            project && hostActions.pruneLaunches ? enabledCapability : noAction,
          copy: enabledCapability,
          logs:
            project && hostActions.openLaunchOutput
              ? enabledCapability
              : noAction,
          manageDefinitions: action,
        },
      };
    },
    actions: undefined as unknown as LaunchPanelActions,
  };

  function original(
    definition: LaunchPanelDefinition,
  ): LaunchDefinition | undefined {
    return definitions.find(
      (item) =>
        item.id === definition.id &&
        item.scope.projectId === definition.scope.projectId,
    );
  }

  async function launchDefinition(
    definition: LaunchPanelDefinition,
    terminateListeners?: import("@nervekit/contracts/launches").LaunchPortConflictListener[],
  ): Promise<void> {
    const projectId = definition.scope.projectId;
    const pending = {
      projectId,
      id: definition.id,
      generation: ++startGeneration,
    };
    runningDefinition = pending;
    try {
      const result = await startLaunchDefinition(
        projectId,
        definition.id,
        terminateListeners,
      );
      if (result.disposition === "port_conflict") {
        portConflict = { definition, ...result.conflict };
        return;
      }
      portConflict = undefined;
      await refreshWorkbenchLaunches();
      notify.success(
        result.disposition === "focused_existing"
          ? "Launch is already running"
          : "Launch started",
        { description: definition.label ?? definition.command },
      );
    } catch (error) {
      showCriticalError("Could not run launch", errorMessage(error));
    } finally {
      if (runningDefinition?.generation === pending.generation)
        runningDefinition = undefined;
    }
  }

  function revision(projectId: string) {
    const value = cachedLaunchCatalog(projectId)?.revision;
    if (!value || launchCatalogError(projectId))
      throw new Error("Refresh the launch catalog before editing.");
    return value;
  }
  async function mutate(
    operation: (
      projectId: string,
      expectedRevision: string,
    ) => Promise<unknown>,
    intentRevision?: string,
  ) {
    const projectId = activeProject()?.id;
    if (!projectId) return;
    try {
      const currentRevision = revision(projectId);
      const expectedRevision = intentRevision ?? currentRevision;
      await operation(projectId, expectedRevision);
    } catch (error) {
      notify.error(
        `Could not update launch organization: ${errorMessage(error)}`,
      );
      throw error;
    } finally {
      await invalidateLaunchCatalog(projectId).catch(() => {});
    }
  }
  const host: LaunchPanelActions = {
    refreshDefinitions: async () => {
      const project = activeProject();
      if (!project) return;
      try {
        await invalidateLaunchCatalog(project.id);
      } catch (error) {
        notify.error(
          `Could not reload launch configurations: ${errorMessage(error)}`,
        );
      }
    },
    createFolder: (input) =>
      mutate((id, rev) => createLaunchFolder(id, input, rev)),
    renameFolder: (folder, label) =>
      mutate((id, rev) => renameLaunchFolder(id, folder.id, label, rev)),
    deleteFolder: (folder) =>
      mutate((id, rev) => deleteLaunchFolder(id, folder.id, rev)),
    moveEntry: ({ expectedRevision, ...input }) =>
      mutate(
        (id, rev) => moveLaunchCatalogEntry(id, input, rev),
        expectedRevision,
      ),
    selectLaunch: async (launchId) => {
      launchState.selectedLaunchId = launchId;
      if (!launchId) {
        launchState.launchLogs = undefined;
        return;
      }
      setLaunchEntryRun(launchEntryKey(launchId), launchId);
      launchState.launchLogs = await getLaunchLogs(launchId);
    },
    openLaunchOutput: (launchId) => hostActions.openLaunchOutput?.(launchId),
    startLaunch: (request: StartLaunchRequest) => {
      const project = activeProject();
      if (!project) return;
      hostActions.runCommand?.({
        projectId: project.id,
        cwd: request.cwd,
        command: request.command,
        name: request.name,
      });
    },
    runDefinition: (definition) => launchDefinition(definition),
    confirmPortConflict: () => {
      const pending = portConflict;
      if (!pending) return;
      return launchDefinition(pending.definition, [...pending.listeners]);
    },
    dismissPortConflict: () => {
      portConflict = undefined;
    },
    cancelLaunch: (id, request) => hostActions.cancelLaunch?.(id, request),
    forceKillLaunch: (id) =>
      hostActions.cancelLaunch?.(id, {
        signal: "SIGKILL",
        reason: "force_kill",
      }),
    restartLaunch: (id) => hostActions.restartLaunch?.(id),
    removeLaunch: (id) => hostActions.removeLaunch?.(id),
    cleanupRuns: (ids) => hostActions.cleanupRuns?.(ids),
    pruneLaunches: () => hostActions.pruneLaunches?.(),
    copyText: async (text) => {
      try {
        await writeClipboardText(text);
        notify.success("Copied to clipboard");
      } catch {
        notify.error("Could not copy to clipboard");
      }
    },
    createDefinition: async (input: CreateLaunchDefinitionRequest) => {
      const project = activeProject();
      if (!project) return;
      try {
        await createLaunchDefinition(
          project.id,
          {
            ...input,
            runPolicy: input.runPolicy ?? "single",
          },
          revision(project.id),
        );
        notify.success("Launch saved");
      } catch (error) {
        notify.error(`Could not save launch: ${errorMessage(error)}`);
        throw error;
      } finally {
        await invalidateLaunchCatalog(project.id).catch(() => {});
      }
    },
    updateDefinition: async (
      definition,
      input: UpdateLaunchDefinitionRequest,
    ) => {
      const project = activeProject();
      const item = original(definition);
      if (!project || !item) return;
      try {
        await updateLaunchDefinition(
          project.id,
          item.id,
          {
            ...input,
            runPolicy: input.runPolicy ?? item.runPolicy,
          },
          revision(project.id),
        );
        notify.success("Launch updated");
      } catch (error) {
        notify.error(`Could not update launch: ${errorMessage(error)}`);
        throw error;
      } finally {
        await invalidateLaunchCatalog(project.id).catch(() => {});
      }
    },
    deleteDefinition: async (definition) => {
      const project = activeProject();
      const item = original(definition);
      if (!project || !item) return;
      try {
        await deleteLaunchDefinition(project.id, item.id, revision(project.id));
        notify.success("Saved launch deleted");
      } catch (error) {
        notify.error(`Could not remove saved launch: ${errorMessage(error)}`);
        throw error;
      } finally {
        await invalidateLaunchCatalog(project.id).catch(() => {});
      }
    },
    loadLogs: async (launchId, query) => {
      launchState.launchLogs = await getLaunchLogs(launchId, query);
    },
  };
  adapter.actions = createLaunchPanelActions(() => adapter.model, host);

  // Revalidate on mount and project switches. Cached definitions render
  // immediately, so the loading state only shows on a cold cache.
  $effect(() => {
    const projectId = activeProject()?.id;
    const revalidation = definitionRevalidation.enter(projectId);
    if (!projectId) {
      loadingDefinitions = false;
      return;
    }
    if (!revalidation) return;

    untrack(() => {
      const cold =
        cachedLaunchDefinitions(revalidation.projectId) === undefined;
      loadingDefinitions = cold;
      void loadLaunchDefinitions(revalidation.projectId)
        .catch((error) =>
          notify.error(
            `Could not load launch configurations: ${errorMessage(error)}`,
          ),
        )
        .finally(() => {
          if (cold && definitionRevalidation.isCurrent(revalidation)) {
            loadingDefinitions = false;
          }
        });
    });
  });

  return adapter;
}
