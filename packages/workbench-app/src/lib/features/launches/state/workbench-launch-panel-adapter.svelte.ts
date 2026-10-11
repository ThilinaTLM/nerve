import type { Project } from "@nervekit/contracts/core";
import { untrack } from "svelte";
import type {
  StartLaunchRequest,
  LaunchDefinition,
  LaunchRecord,
} from "$lib/api";
import type { CancelLaunchRequest } from "@nervekit/contracts/launches";
import type {
  CreateLaunchDefinitionRequest,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  getLaunchLogs,
  startLaunchDefinition,
} from "$lib/features/launches/api/launches.api";
import { launchState } from "$lib/features/launches/state/launch-state.svelte";
import {
  setLaunchEntryRun,
  launchEntryKey,
} from "$lib/features/launches/state/launch-tabs.svelte";
import { refreshWorkbenchLaunches } from "./launch-events";
import {
  createLaunchDefinition,
  deleteLaunchDefinition,
  updateLaunchDefinition,
} from "$lib/api";
import {
  cachedLaunchDefinitions,
  loadLaunchDefinitions,
  removeCachedLaunchDefinition,
  upsertCachedLaunchDefinition,
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
  let runningDefinitionId = $state<string | undefined>(undefined);
  let portConflict = $state<LaunchPanelModel["portConflict"]>(undefined);
  const definitionRevalidation = createLaunchDefinitionRevalidationGate();
  const definitions = $derived(
    cachedLaunchDefinitions(activeProject()?.id) ?? [],
  );

  const unavailable = (message: string) => disabledCapability(message);
  const adapter = {
    get model(): LaunchPanelModel {
      const project = activeProject();
      const noProject = unavailable("Select a project to manage launches.");
      const noRunner = unavailable(
        "Launch execution is unavailable in this host.",
      );
      const noAction = unavailable(
        "This launch operation is unavailable in this host.",
      );
      const action = project ? enabledCapability : noProject;
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
        definitions: definitions.map(normalizeLaunchDefinition),
        defaultCwd: project?.directory ?? "",
        definitionsLoading: loadingDefinitions,
        runningDefinitionId,
        portConflict,
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
    return definitions.find((item) => item.id === definition.id);
  }

  async function launchDefinition(
    definition: LaunchPanelDefinition,
    terminateListeners?: import("@nervekit/contracts/launches").LaunchPortConflictListener[],
  ): Promise<void> {
    const project = activeProject();
    if (!project) return;
    runningDefinitionId = definition.id;
    try {
      const result = await startLaunchDefinition(
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
      runningDefinitionId = undefined;
    }
  }

  const host: LaunchPanelActions = {
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
        const created = await createLaunchDefinition(project.id, {
          ...input,
          runPolicy: input.runPolicy ?? "single",
        });
        upsertCachedLaunchDefinition(project.id, created);
        notify.success("Launch saved");
      } catch (error) {
        notify.error(`Could not save launch: ${errorMessage(error)}`);
        throw error;
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
        const updated = await updateLaunchDefinition(project.id, item.id, {
          ...input,
          runPolicy: input.runPolicy ?? item.runPolicy,
        });
        upsertCachedLaunchDefinition(project.id, updated);
        notify.success("Launch updated");
      } catch (error) {
        notify.error(`Could not update launch: ${errorMessage(error)}`);
        throw error;
      }
    },
    deleteDefinition: async (definition) => {
      const project = activeProject();
      const item = original(definition);
      if (!project || !item) return;
      try {
        await deleteLaunchDefinition(project.id, item.id);
        removeCachedLaunchDefinition(item.id);
        notify.success("Saved launch deleted");
      } catch (error) {
        notify.error(`Could not remove saved launch: ${errorMessage(error)}`);
        throw error;
      }
    },
    loadLogs: async (launchId, query) => {
      launchState.launchLogs = await getLaunchLogs(launchId, query);
    },
  };
  adapter.actions = createLaunchPanelActions(() => adapter.model, host);

  $effect(() => {
    const cacheDefinition = (event: { data?: Record<string, unknown> }) => {
      const definition = event.data?.definition as LaunchDefinition | undefined;
      if (definition?.scope.kind !== "project") return;
      upsertCachedLaunchDefinition(definition.scope.projectId, definition);
    };
    const disposeCreated = onEvent("launchDefinition.created", cacheDefinition);
    const disposeUpdated = onEvent("launchDefinition.updated", cacheDefinition);
    const disposeDeleted = onEvent("launchDefinition.deleted", (event) => {
      removeCachedLaunchDefinition(String(event.data?.definitionId ?? ""));
    });
    return () => {
      disposeCreated();
      disposeUpdated();
      disposeDeleted();
    };
  });

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
