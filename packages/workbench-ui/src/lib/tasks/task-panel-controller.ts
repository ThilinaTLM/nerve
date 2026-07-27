import type { TaskDefinition, TaskRecord } from "@nervekit/contracts";
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
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    runPolicy: definition.runPolicy,
  };
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
  const named =
    entry.definition?.label ?? entry.run.displayName ?? entry.run.name;
  if (named && named.trim().length > 0)
    return { text: named, isCommand: false };
  const command = entry.run.command;
  return { text: command || "Task", isCommand: command.length > 0 };
}

/** Lineage key shared by a definition's runs and by restart chains. */
function lineageKey(task: TaskRecord): string {
  return task.definitionId ?? task.restartRootTaskId ?? task.id;
}

/** All runs that belong to the same lineage as `task`, newest first. */
export function taskLineageRuns(
  tasks: readonly TaskRecord[],
  task: TaskRecord | undefined,
): TaskRecord[] {
  if (!task) return [];
  const key = lineageKey(task);
  return tasks
    .filter((candidate) => lineageKey(candidate) === key)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Formats a run start time for compact single-line row and selector labels. */
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
 * Projects the panel into its two flat sections: saved definitions and every
 * individual run, both newest first with recovery concerns hoisted to the top.
 */
export function projectTaskPanel(
  definitions: readonly TaskPanelDefinition[],
  tasks: readonly TaskRecord[],
): { definitions: TaskDefinitionEntry[]; runs: TaskRunEntry[] } {
  const definitionsById = new Map(definitions.map((item) => [item.id, item]));
  const runsByDefinition = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!task.definitionId) continue;
    const runs = runsByDefinition.get(task.definitionId) ?? [];
    runs.push(task);
    runsByDefinition.set(task.definitionId, runs);
  }

  const definitionEntries = definitions
    .map((definition) =>
      buildDefinitionEntry(
        definition,
        runsByDefinition.get(definition.id) ?? [],
      ),
    )
    .sort(
      (left, right) =>
        Number(right.needsRecovery) - Number(left.needsRecovery) ||
        (
          right.latestRun?.startedAt ?? right.definition.updatedAt
        ).localeCompare(left.latestRun?.startedAt ?? left.definition.updatedAt),
    );

  const runEntries = tasks
    .map<TaskRunEntry>((run) => ({
      key: run.id,
      run,
      definition: run.definitionId
        ? definitionsById.get(run.definitionId)
        : undefined,
      isActive: RUNNING_LIKE_STATUSES.has(run.status),
      needsRecovery: RECOVERY_STATUSES.has(run.status),
    }))
    .sort(
      (left, right) =>
        Number(right.needsRecovery) - Number(left.needsRecovery) ||
        right.run.startedAt.localeCompare(left.run.startedAt),
    );

  return { definitions: definitionEntries, runs: runEntries };
}

function buildDefinitionEntry(
  definition: TaskPanelDefinition,
  runs: readonly TaskRecord[],
): TaskDefinitionEntry {
  const sorted = [...runs].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  return {
    key: definition.id,
    definition,
    runs: sorted,
    activeRuns: sorted.filter((task) => RUNNING_LIKE_STATUSES.has(task.status)),
    latestRun: sorted[0],
    needsRecovery: sorted.some((task) => RECOVERY_STATUSES.has(task.status)),
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
    cancelTask: (taskId) => {
      if (enabled("cancel")) return host.cancelTask(taskId);
    },
    restartTask: (taskId) => {
      if (enabled("restart")) return host.restartTask(taskId);
    },
    removeTask: (taskId) => {
      if (enabled("remove")) return host.removeTask(taskId);
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
