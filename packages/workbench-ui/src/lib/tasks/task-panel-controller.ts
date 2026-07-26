import type {
  PinnedCommand,
  TaskDefinition,
  TaskRecord,
} from "@nervekit/contracts";
import type {
  NormalizedPinnedCommand,
  TaskPanelActions,
  TaskPanelEntry,
  TaskPanelModel,
} from "./task-panel-types.js";

const ACTIVE_TASK_STATUSES = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
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

export function normalizePinnedCommand(
  command: PinnedCommand | TaskDefinition,
): NormalizedPinnedCommand {
  return {
    id: command.id.replace(/^pin_/, "taskdef_"),
    label: command.label,
    command: command.command,
    cwd: command.cwd,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    runPolicy: "runPolicy" in command ? command.runPolicy : "single",
  };
}

export function projectTaskPanelEntries(
  definitions: readonly NormalizedPinnedCommand[],
  tasks: readonly TaskRecord[],
): { tasks: TaskPanelEntry[]; history: TaskPanelEntry[] } {
  const byKey = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const key = task.definitionId ?? task.restartRootTaskId ?? task.id;
    const runs = byKey.get(key) ?? [];
    runs.push(task);
    byKey.set(key, runs);
  }
  const definitionsById = new Map(definitions.map((item) => [item.id, item]));
  const entries: TaskPanelEntry[] = [];
  for (const definition of definitions) {
    entries.push(
      buildEntry(definition.id, definition, byKey.get(definition.id) ?? []),
    );
  }
  for (const [key, runs] of byKey) {
    if (definitionsById.has(key)) continue;
    entries.push(buildEntry(key, undefined, runs));
  }
  const main = entries.filter(
    (entry) =>
      entry.definition || entry.activeRuns.length > 0 || entry.needsRecovery,
  );
  const history = entries.filter(
    (entry) =>
      !entry.definition &&
      entry.activeRuns.length === 0 &&
      !entry.needsRecovery,
  );
  const sort = (left: TaskPanelEntry, right: TaskPanelEntry) =>
    Number(right.needsRecovery) - Number(left.needsRecovery) ||
    (
      right.latestRun?.startedAt ??
      right.definition?.updatedAt ??
      ""
    ).localeCompare(
      left.latestRun?.startedAt ?? left.definition?.updatedAt ?? "",
    );
  return { tasks: main.sort(sort), history: history.sort(sort) };
}

function buildEntry(
  key: string,
  definition: NormalizedPinnedCommand | undefined,
  runs: readonly TaskRecord[],
): TaskPanelEntry {
  const sorted = [...runs].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const activeRuns = sorted.filter((task) =>
    ["starting", "running", "ready", "stopping", "recovered"].includes(
      task.status,
    ),
  );
  return {
    key,
    definition,
    runs: sorted,
    activeRuns,
    latestRun: sorted[0],
    inHistory: !definition && activeRuns.length === 0,
    needsRecovery: sorted.some((task) =>
      ["recovered", "recovery_unknown", "orphaned"].includes(task.status),
    ),
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
    runPinned: (command) => {
      if (enabled("start")) return host.runPinned(command);
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
    pinTask: (task) => {
      if (enabled("pin")) return host.pinTask(task);
    },
    copyCommand: (command) => {
      if (enabled("copy")) return host.copyCommand(command);
    },
    createPinned: (input) => {
      if (enabled("managePinned")) return host.createPinned(input);
    },
    updatePinned: (command, input) => {
      if (enabled("managePinned")) return host.updatePinned(command, input);
    },
    deletePinned: (command) => {
      if (enabled("managePinned")) return host.deletePinned(command);
    },
    loadLogs: (taskId, query) => {
      if (enabled("logs")) return host.loadLogs(taskId, query);
    },
  };
}
