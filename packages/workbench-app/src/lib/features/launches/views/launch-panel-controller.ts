import { launchEntryIdentity } from "$lib/domain/workspace/launch-entry-identity";
import type {
  LaunchDefinition,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type {
  LaunchDefinitionEntry,
  LaunchPanelActions,
  LaunchPanelDefinition,
  LaunchPanelModel,
  LaunchRunEntry,
} from "./launch-panel-types.js";

const ACTIVE_LAUNCH_STATUSES = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
]);

/** Statuses that still occupy a run slot, while the process is active. */
const RUNNING_LIKE_STATUSES = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
]);

const REMOVABLE_STATUSES = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

export type LaunchGroups = {
  running: LaunchRecord[];
  finished: LaunchRecord[];
};

export function groupLaunches(launches: readonly LaunchRecord[]): LaunchGroups {
  return {
    running: launches.filter((launch) =>
      ACTIVE_LAUNCH_STATUSES.has(launch.status),
    ),
    finished: launches.filter(
      (launch) => !ACTIVE_LAUNCH_STATUSES.has(launch.status),
    ),
  };
}

export function normalizeLaunchDefinition(
  definition: LaunchDefinition,
): LaunchPanelDefinition {
  return {
    id: definition.id,
    scope: definition.scope,
    parentFolderId: definition.parentFolderId,
    order: definition.order,
    label: definition.label,
    command: definition.command,
    cwd: definition.cwd,
    port: definition.port,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    runPolicy: definition.runPolicy,
  };
}

/** Maps the selected log stream to the single visual item that owns it. */
/** A saved launch port is optional; when present it must be a TCP port. */
export function isValidLaunchPort(port: number | undefined): boolean {
  return (
    port === undefined ||
    (Number.isInteger(port) && port >= 1 && port <= 65_535)
  );
}

/**
 * Builds the saved-launch request from raw form fields, trimming text and
 * omitting empty optionals. Undefined when the form cannot be saved.
 */
export function launchDefinitionRequest(input: {
  readonly label: string;
  readonly command: string;
  readonly cwd: string;
  readonly port: number | undefined;
  readonly runPolicy: "single" | "concurrent";
}): UpdateLaunchDefinitionRequest | undefined {
  const command = input.command.trim();
  if (command.length === 0 || !isValidLaunchPort(input.port)) return undefined;
  const label = input.label.trim();
  const cwd = input.cwd.trim();
  return {
    command,
    ...(label.length > 0 ? { label } : {}),
    ...(cwd.length > 0 ? { cwd } : {}),
    ...(input.port === undefined ? {} : { port: input.port }),
    runPolicy: input.runPolicy,
  };
}

/** Names the processes holding a saved launch's port for the confirm prompt. */
export function launchPortConflictDescription(
  conflict: LaunchPanelModel["portConflict"],
): string {
  if (!conflict) return "";
  const processes = [
    ...new Map(
      conflict.listeners.map((listener) => [
        `${listener.pid}|${listener.identity}`,
        `${listener.processName ?? "Process"} (PID ${listener.pid})`,
      ]),
    ).values(),
  ];
  return `${processes.join(", ")} is listening on TCP port ${conflict.port}. Terminate ${processes.length === 1 ? "it" : "them"} and run this launch?`;
}

/** The center tab a run belongs to: its definition, restart chain, or itself. */
export function launchEntryId(launch: LaunchRecord): string {
  return launchEntryIdentity(launch);
}

/** Every run sharing `launchId`'s center-tab entry, newest first. */
export function siblingLaunchRuns(
  launches: readonly LaunchRecord[],
  launchId: string,
): LaunchRecord[] {
  const current = launches.find((launch) => launch.id === launchId);
  if (!current) return [];
  const entryId = launchEntryId(current);
  return launches
    .filter((launch) => launchEntryId(launch) === entryId)
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function launchPanelActiveItemKey(
  launch: LaunchRecord | undefined,
): string | undefined {
  return launch ? (launch.definitionId ?? launch.id) : undefined;
}

export interface LaunchEntryLabel {
  readonly text: string;
  readonly isCommand: boolean;
}

/**
 * Resolves the single-line row label for a saved definition. The definition label
 * always wins so that adopted runs immediately display its name.
 */
export function launchDefinitionLabel(
  entry: LaunchDefinitionEntry,
): LaunchEntryLabel {
  const named = entry.definition.label;
  if (named && named.trim().length > 0)
    return { text: named, isCommand: false };
  const command = entry.definition.command;
  return { text: command || "Launch", isCommand: command.length > 0 };
}

/** Resolves the single-line row label for an individual run. */
export function launchRunLabel(entry: LaunchRunEntry): LaunchEntryLabel {
  const named = entry.run.displayName ?? entry.run.name;
  if (named && named.trim().length > 0)
    return { text: named, isCommand: false };
  const command = entry.run.command;
  return { text: command || "Launch", isCommand: command.length > 0 };
}

/** Formats a run start time for compact single-line row labels. */
export function formatLaunchRunTime(startedAt: string): string {
  const started = new Date(startedAt);
  const sameDay = started.toDateString() === new Date().toDateString();
  return sameDay
    ? started.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : started.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * Projects the panel into its two sections: saved definitions with their own runs
 * nested underneath, and standalone/unresolved runs. Definitions retain manual
 * placement order; runs are newest first.
 */
export function projectLaunchPanel(
  definitions: readonly LaunchPanelDefinition[],
  launches: readonly LaunchRecord[],
  catalogAuthoritative = true,
): { definitions: LaunchDefinitionEntry[]; runs: LaunchRunEntry[] } {
  const runsByDefinition = new Map<string, LaunchRecord[]>();
  for (const launch of launches) {
    if (
      !launch.definitionId ||
      !definitions.some(
        (definition) =>
          definition.id === launch.definitionId &&
          definition.scope.projectId === launch.projectId,
      )
    )
      continue;
    const runs = runsByDefinition.get(launch.definitionId) ?? [];
    runs.push(launch);
    runsByDefinition.set(launch.definitionId, runs);
  }

  const definitionEntries = sortDefinitionEntries(
    definitions.map((definition) =>
      buildDefinitionEntry(
        definition,
        runsByDefinition.get(definition.id) ?? [],
      ),
    ),
  );

  const runEntries = launches
    .filter(
      (run) =>
        !run.definitionId ||
        !definitions.some(
          (definition) =>
            definition.id === run.definitionId &&
            definition.scope.projectId === run.projectId,
        ),
    )
    .map((run) => ({
      ...toRunEntry(run),
      ...(run.definitionId && !catalogAuthoritative
        ? { definitionUnavailable: true }
        : {}),
    }))
    .sort((left, right) =>
      right.run.startedAt.localeCompare(left.run.startedAt),
    );

  return { definitions: definitionEntries, runs: runEntries };
}

/** Placement, never labels or execution recency, controls saved order. */
function sortDefinitionEntries(
  entries: LaunchDefinitionEntry[],
): LaunchDefinitionEntry[] {
  return entries.sort((a, b) => a.definition.order - b.definition.order);
}

/** Distinct active definitions in each folder's complete descendant subtree. */
export function launchActivity(
  definitions: readonly LaunchPanelDefinition[],
  folders: readonly import("@nervekit/contracts/launch-definitions").LaunchFolder[],
  launches: readonly LaunchRecord[],
) {
  const active = new Set(
    definitions
      .filter((definition) =>
        launches.some(
          (run) =>
            run.projectId === definition.scope.projectId &&
            run.definitionId === definition.id &&
            ACTIVE_LAUNCH_STATUSES.has(run.status),
        ),
      )
      .map((definition) => definition.id),
  );
  const folderCounts = new Map<string, number>();
  for (const definition of definitions) {
    if (!active.has(definition.id)) continue;
    let parent = definition.parentFolderId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      folderCounts.set(parent, (folderCounts.get(parent) ?? 0) + 1);
      parent =
        folders.find((folder) => folder.id === parent)?.parentFolderId ?? null;
    }
  }
  return { activeDefinitionCount: active.size, folderCounts };
}

/** Status-derived row facts for one run. */
export function toRunEntry(
  run: LaunchRecord,
  definition?: LaunchPanelDefinition,
): LaunchRunEntry {
  return {
    key: run.id,
    run,
    definition,
    isActive: RUNNING_LIKE_STATUSES.has(run.status),
    canForceKill: run.status === "stopping",
    isRemovable: REMOVABLE_STATUSES.has(run.status),
  };
}

function buildDefinitionEntry(
  definition: LaunchPanelDefinition,
  runs: readonly LaunchRecord[],
): LaunchDefinitionEntry {
  const sorted = [...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((run) => toRunEntry(run, definition));
  return {
    key: definition.id,
    definition,
    runs: sorted,
    activeRuns: sorted
      .filter((entry) => entry.isActive)
      .map((entry) => entry.run),
    latestRun: sorted[0]?.run,
  };
}

export function createLaunchPanelActions(
  model: () => LaunchPanelModel,
  host: LaunchPanelActions,
): LaunchPanelActions {
  const available = () => model().availability.available;
  const enabled = (capability: keyof LaunchPanelModel["capabilities"]) =>
    available() && model().capabilities[capability].enabled;

  return {
    refreshDefinitions: () => {
      if (available()) return host.refreshDefinitions();
    },
    createFolder: (input) => {
      if (enabled("manageDefinitions")) return host.createFolder(input);
    },
    renameFolder: (folder, label) => {
      if (enabled("manageDefinitions")) return host.renameFolder(folder, label);
    },
    deleteFolder: (folder) => {
      if (enabled("manageDefinitions")) return host.deleteFolder(folder);
    },
    moveEntry: (input) => {
      if (enabled("manageDefinitions")) return host.moveEntry(input);
    },
    selectLaunch: (launchId) => host.selectLaunch(launchId),
    openLaunchOutput: (launchId) => {
      if (enabled("logs")) return host.openLaunchOutput(launchId);
    },
    startLaunch: (request) => {
      if (enabled("start")) return host.startLaunch(request);
    },
    runDefinition: (definition) => {
      if (enabled("start")) return host.runDefinition(definition);
    },
    confirmPortConflict: () => {
      if (enabled("start")) return host.confirmPortConflict();
    },
    dismissPortConflict: () => host.dismissPortConflict(),
    cancelLaunch: (launchId, request) => {
      if (enabled("cancel")) return host.cancelLaunch(launchId, request);
    },
    forceKillLaunch: (launchId) => {
      if (enabled("cancel"))
        return host.cancelLaunch(launchId, {
          signal: "SIGKILL",
          reason: "force_kill",
        });
    },
    restartLaunch: (launchId) => {
      if (enabled("restart")) return host.restartLaunch(launchId);
    },
    removeLaunch: (launchId) => {
      if (enabled("remove")) return host.removeLaunch(launchId);
    },
    cleanupRuns: (launchIds) => {
      if (enabled("remove")) return host.cleanupRuns(launchIds);
    },
    pruneLaunches: () => {
      if (enabled("prune")) return host.pruneLaunches();
    },
    copyText: (text) => {
      if (enabled("copy")) return host.copyText(text);
    },
    createDefinition: (input) => {
      if (enabled("manageDefinitions")) return host.createDefinition(input);
    },
    updateDefinition: (definition, input) => {
      if (enabled("manageDefinitions"))
        return host.updateDefinition(definition, input);
    },
    deleteDefinition: (definition) => {
      if (enabled("manageDefinitions"))
        return host.deleteDefinition(definition);
    },
    loadLogs: (launchId, query) => {
      if (enabled("logs")) return host.loadLogs(launchId, query);
    },
  };
}
