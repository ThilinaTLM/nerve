import type { TaskDefinition } from "@nervekit/contracts/task-definitions";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import type {
  TaskDefinitionEntry,
  TaskPanelActions,
  TaskPanelDefinition,
  TaskPanelModel,
  TaskRunEntry,
} from "./task-panel-types.js";

const ACTIVE_TASK_STATUSES = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
]);

/** Statuses that still occupy a run slot, including recovered supervision. */
const RUNNING_LIKE_STATUSES = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
  "recovered",
]);

/** Statuses that need a human recovery decision before destructive actions. */
const RECOVERY_STATUSES = new Set([
  "recovered",
  "recovery_unknown",
  "orphaned",
]);

const REMOVABLE_STATUSES = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
]);

const DEFINITION_ALPHABETICAL_WEIGHT = 0.7;
const DEFINITION_RECENCY_WEIGHT = 0.3;
const definitionCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export type TaskGroups = {
  running: TaskRecord[];
  orphaned: TaskRecord[];
  finished: TaskRecord[];
};

export function groupTasks(tasks: readonly TaskRecord[]): TaskGroups {
  return {
    running: tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)),
    orphaned: tasks.filter((task) => task.status === "orphaned"),
    finished: tasks.filter(
      (task) =>
        !ACTIVE_TASK_STATUSES.has(task.status) && task.status !== "orphaned",
    ),
  };
}

export function normalizeTaskDefinition(
  definition: TaskDefinition,
): TaskPanelDefinition {
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
export function taskPanelActiveItemKey(
  task: TaskRecord | undefined,
): string | undefined {
  return task ? (task.definitionId ?? task.id) : undefined;
}

export interface TaskEntryLabel {
  readonly text: string;
  readonly isCommand: boolean;
}

/**
 * Resolves the single-line row label for a saved definition. The definition label
 * always wins so that adopted runs immediately display its name.
 */
export function taskDefinitionLabel(
  entry: TaskDefinitionEntry,
): TaskEntryLabel {
  const named = entry.definition.label;
  if (named && named.trim().length > 0)
    return { text: named, isCommand: false };
  const command = entry.definition.command;
  return { text: command || "Task", isCommand: command.length > 0 };
}

/** Resolves the single-line row label for an individual run. */
export function taskRunLabel(entry: TaskRunEntry): TaskEntryLabel {
  const named = entry.run.displayName ?? entry.run.name;
  if (named && named.trim().length > 0)
    return { text: named, isCommand: false };
  const command = entry.run.command;
  return { text: command || "Task", isCommand: command.length > 0 };
}

/** Formats a run start time for compact single-line row labels. */
export function formatTaskRunTime(startedAt: string): string {
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
 * newest first with recovery concerns hoisted to the top.
 */
export function projectTaskPanel(
  definitions: readonly TaskPanelDefinition[],
  tasks: readonly TaskRecord[],
): { definitions: TaskDefinitionEntry[]; runs: TaskRunEntry[] } {
  const runsByDefinition = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!task.definitionId) continue;
    const runs = runsByDefinition.get(task.definitionId) ?? [];
    runs.push(task);
    runsByDefinition.set(task.definitionId, runs);
  }

  const definitionEntries = sortDefinitionEntries(
    definitions.map((definition) =>
      buildDefinitionEntry(
        definition,
        runsByDefinition.get(definition.id) ?? [],
      ),
    ),
  );

  const runEntries = tasks
    .filter((run) => !run.definitionId)
    .map((run) => toRunEntry(run))
    .sort(
      (left, right) =>
        Number(right.needsRecovery) - Number(left.needsRecovery) ||
        right.run.startedAt.localeCompare(left.run.startedAt),
    );

  return { definitions: definitionEntries, runs: runEntries };
}

function definitionSortLabel(entry: TaskDefinitionEntry): string {
  const label = entry.definition.label?.trim();
  return label || entry.definition.command;
}

function definitionRecency(entry: TaskDefinitionEntry): string {
  return entry.latestRun?.startedAt ?? entry.definition.updatedAt;
}

/**
 * Keeps saved tasks primarily alphabetical while allowing recent activity to
 * improve their position modestly. Rank blending avoids the distracting jump
 * to first place caused by a strict newest-first comparison.
 */
function sortDefinitionEntries(
  entries: TaskDefinitionEntry[],
): TaskDefinitionEntry[] {
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
  const score = (entry: TaskDefinitionEntry) =>
    (alphabeticalRank.get(entry.key) ?? 0) * DEFINITION_ALPHABETICAL_WEIGHT +
    (recencyRank.get(entry.key) ?? 0) * DEFINITION_RECENCY_WEIGHT;

  return [...entries].sort(
    (left, right) =>
      score(left) - score(right) ||
      Number(right.needsRecovery) - Number(left.needsRecovery) ||
      definitionCollator.compare(
        definitionSortLabel(left),
        definitionSortLabel(right),
      ) ||
      left.definition.id.localeCompare(right.definition.id),
  );
}

function toRunEntry(
  run: TaskRecord,
  definition?: TaskPanelDefinition,
): TaskRunEntry {
  return {
    key: run.id,
    run,
    definition,
    isActive: RUNNING_LIKE_STATUSES.has(run.status),
    canForceKill: run.status === "recovered" || run.status === "stopping",
    isRemovable: REMOVABLE_STATUSES.has(run.status),
    needsRecovery: RECOVERY_STATUSES.has(run.status),
  };
}

function buildDefinitionEntry(
  definition: TaskPanelDefinition,
  runs: readonly TaskRecord[],
): TaskDefinitionEntry {
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
    needsRecovery: sorted.some((entry) => entry.needsRecovery),
  };
}

export function createTaskPanelActions(
  model: () => TaskPanelModel,
  host: TaskPanelActions,
): TaskPanelActions {
  const available = () => model().availability.available;
  const enabled = (capability: keyof TaskPanelModel["capabilities"]) =>
    available() && model().capabilities[capability].enabled;

  return {
    selectTask: (taskId) => host.selectTask(taskId),
    openTaskOutput: (taskId) => {
      if (enabled("logs")) return host.openTaskOutput(taskId);
    },
    startTask: (request) => {
      if (enabled("start")) return host.startTask(request);
    },
    runDefinition: (definition) => {
      if (enabled("start")) return host.runDefinition(definition);
    },
    confirmPortConflict: () => {
      if (enabled("start")) return host.confirmPortConflict();
    },
    dismissPortConflict: () => host.dismissPortConflict(),
    cancelTask: (taskId, request) => {
      if (enabled("cancel")) return host.cancelTask(taskId, request);
    },
    forceKillTask: (taskId) => {
      if (enabled("cancel"))
        return host.cancelTask(taskId, {
          signal: "SIGKILL",
          reason: "force_kill",
        });
    },
    restartTask: (taskId) => {
      if (enabled("restart")) return host.restartTask(taskId);
    },
    removeTask: (taskId) => {
      if (enabled("remove")) return host.removeTask(taskId);
    },
    cleanupRuns: (taskIds) => {
      if (enabled("remove")) return host.cleanupRuns(taskIds);
    },
    pruneTasks: () => {
      if (enabled("prune")) return host.pruneTasks();
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
    loadLogs: (taskId, query) => {
      if (enabled("logs")) return host.loadLogs(taskId, query);
    },
  };
}
