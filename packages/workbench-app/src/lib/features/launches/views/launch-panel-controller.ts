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

const DEFINITION_ALPHABETICAL_WEIGHT = 0.7;
const DEFINITION_RECENCY_WEIGHT = 0.3;
const definitionCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

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
  return launch.definitionId ?? launch.restartRootLaunchId ?? launch.id;
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
 * nested underneath, and the ad-hoc runs that no definition started. Both are
 * newest first.
 */
export function projectLaunchPanel(
  definitions: readonly LaunchPanelDefinition[],
  launches: readonly LaunchRecord[],
): { definitions: LaunchDefinitionEntry[]; runs: LaunchRunEntry[] } {
  const runsByDefinition = new Map<string, LaunchRecord[]>();
  for (const launch of launches) {
    if (!launch.definitionId) continue;
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
    .filter((run) => !run.definitionId)
    .map((run) => toRunEntry(run))
    .sort((left, right) =>
      right.run.startedAt.localeCompare(left.run.startedAt),
    );

  return { definitions: definitionEntries, runs: runEntries };
}

function definitionSortLabel(entry: LaunchDefinitionEntry): string {
  const label = entry.definition.label?.trim();
  return label || entry.definition.command;
}

function definitionRecency(entry: LaunchDefinitionEntry): string {
  return entry.latestRun?.startedAt ?? entry.definition.updatedAt;
}

/**
 * Keeps saved launches primarily alphabetical while allowing recent activity to
 * improve their position modestly. Rank blending avoids the distracting jump
 * to first place caused by a strict newest-first comparison.
 */
function sortDefinitionEntries(
  entries: LaunchDefinitionEntry[],
): LaunchDefinitionEntry[] {
  const alphabetical = [...entries].sort(
    (left, right) =>
      definitionCollator.compare(
        definitionSortLabel(left),
        definitionSortLabel(right),
      ) || left.definition.id.localeCompare(right.definition.id),
  );
  const recent = [...entries].sort(
    (left, right) =>
      definitionRecency(right).localeCompare(definitionRecency(left)) ||
      left.definition.id.localeCompare(right.definition.id),
  );
  const alphabeticalRank = new Map(
    alphabetical.map((entry, index) => [entry.key, index]),
  );
  const recencyRank = new Map(recent.map((entry, index) => [entry.key, index]));
  const score = (entry: LaunchDefinitionEntry) =>
    (alphabeticalRank.get(entry.key) ?? 0) * DEFINITION_ALPHABETICAL_WEIGHT +
    (recencyRank.get(entry.key) ?? 0) * DEFINITION_RECENCY_WEIGHT;

  return [...entries].sort(
    (left, right) =>
      score(left) - score(right) ||
      definitionCollator.compare(
        definitionSortLabel(left),
        definitionSortLabel(right),
      ) ||
      left.definition.id.localeCompare(right.definition.id),
  );
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
