import type {
  PinnedCommand,
  SandboxPinnedCommand,
  TaskRecord,
} from "@nervekit/contracts";
import type {
  NormalizedPinnedCommand,
  TaskPanelActions,
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
  command: PinnedCommand | SandboxPinnedCommand,
): NormalizedPinnedCommand {
  return {
    id: command.id,
    label: command.label,
    command: command.command,
    cwd: command.cwd,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
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
