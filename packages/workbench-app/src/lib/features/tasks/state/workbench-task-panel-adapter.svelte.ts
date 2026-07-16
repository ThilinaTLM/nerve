import type {
  CreatePinnedCommandRequest,
  PinnedCommand,
  ProjectRecord,
  StartTaskRequest,
  TaskRecord,
  UpdatePinnedCommandRequest,
} from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import { getTaskLogs } from "$lib/features/tasks/api/tasks.api";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import {
  createPinnedCommand,
  deletePinnedCommand,
  getPinnedCommands,
  updatePinnedCommand,
} from "$lib/api";
import {
  createTaskPanelActions,
  disabledCapability,
  enabledCapability,
  normalizePinnedCommand,
  type NormalizedPinnedCommand,
  type TaskPanelActions,
  type TaskPanelModel,
} from "@nervekit/workbench-ui";

export type WorkbenchTaskPanelHostActions = {
  readonly openTaskOutput?: (id: string) => void;
  readonly cancelTask?: (id: string) => void;
  readonly restartTask?: (id: string) => void;
  readonly removeTask?: (id: string) => void;
  readonly pruneTasks?: () => void;
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

export function createWorkbenchTaskPanelAdapter(
  activeProject: () => ProjectRecord | undefined,
  tasks: () => readonly TaskRecord[],
  selectedTask: () => TaskRecord | undefined,
  hostActions: WorkbenchTaskPanelHostActions,
): { readonly model: TaskPanelModel; readonly actions: TaskPanelActions } {
  let pinned = $state<PinnedCommand[]>([]);
  let loadingPinned = $state(false);
  let runningPinnedId = $state<string | undefined>(undefined);
  let lastLoadedProjectId = $state<string | undefined>(undefined);

  const unavailable = (message: string) => disabledCapability(message);
  const adapter = {
    get model(): TaskPanelModel {
      const project = activeProject();
      const noProject = unavailable("Select a project to manage tasks.");
      const noRunner = unavailable(
        "Task execution is unavailable in this host.",
      );
      const noAction = unavailable(
        "This task operation is unavailable in this host.",
      );
      const action = project ? enabledCapability : noProject;
      return {
        availability: project
          ? { available: true }
          : {
              available: false,
              message: "Select a project to manage its tasks.",
            },
        tasks: tasks(),
        selectedTask: selectedTask(),
        selectedLogs: taskState.taskLogs,
        logsLoading: false,
        pinnedCommands: pinned.map(normalizePinnedCommand),
        defaultCwd: project?.dir ?? "",
        pinnedLoading: loadingPinned,
        runningPinnedId,
        capabilities: {
          start:
            project && hostActions.runCommand ? enabledCapability : noRunner,
          cancel:
            project && hostActions.cancelTask ? enabledCapability : noAction,
          restart:
            project && hostActions.restartTask ? enabledCapability : noAction,
          remove:
            project && hostActions.removeTask ? enabledCapability : noAction,
          prune:
            project && hostActions.pruneTasks ? enabledCapability : noAction,
          pin: action,
          copy: enabledCapability,
          logs:
            project && hostActions.openTaskOutput
              ? enabledCapability
              : noAction,
          managePinned: action,
        },
      };
    },
    actions: undefined as unknown as TaskPanelActions,
  };

  function original(
    command: NormalizedPinnedCommand,
  ): PinnedCommand | undefined {
    return pinned.find((item) => item.id === command.id);
  }

  const host: TaskPanelActions = {
    selectTask: (taskId) => {
      taskState.selectedTaskId = taskId;
    },
    openTaskOutput: (taskId) => hostActions.openTaskOutput?.(taskId),
    startTask: (request: StartTaskRequest) => {
      const project = activeProject();
      if (!project) return;
      hostActions.runCommand?.({
        projectId: project.id,
        cwd: request.cwd,
        command: request.command,
        name: request.name,
      });
    },
    runPinned: (command) => {
      const project = activeProject();
      if (!project) return;
      runningPinnedId = command.id;
      hostActions.runCommand?.({
        projectId: project.id,
        cwd: command.cwd ?? project.dir,
        command: command.command,
        name: command.label ?? command.command,
      });
      window.setTimeout(() => {
        if (runningPinnedId === command.id) runningPinnedId = undefined;
      }, 1_200);
    },
    cancelTask: (id) => hostActions.cancelTask?.(id),
    restartTask: (id) => hostActions.restartTask?.(id),
    removeTask: (id) => hostActions.removeTask?.(id),
    pruneTasks: () => hostActions.pruneTasks?.(),
    pinTask: async (task) => {
      const project = activeProject();
      if (!project) return;
      try {
        const created = await createPinnedCommand(project.id, {
          command: task.command,
          label: task.name,
          cwd: task.cwd === project.dir ? undefined : task.cwd,
        });
        pinned = [...pinned, created];
        notify.success("Command pinned");
      } catch (error) {
        notify.error(`Could not pin command: ${errorMessage(error)}`);
      }
    },
    copyCommand: async (command) => {
      try {
        await writeClipboardText(command);
        notify.success("Copied command");
      } catch {
        notify.error("Could not copy to clipboard");
      }
    },
    createPinned: async (input: CreatePinnedCommandRequest) => {
      const project = activeProject();
      if (!project) return;
      try {
        const created = await createPinnedCommand(project.id, input);
        pinned = [...pinned, created];
        notify.success("Command pinned");
      } catch (error) {
        notify.error(`Could not pin command: ${errorMessage(error)}`);
        throw error;
      }
    },
    updatePinned: async (command, input: UpdatePinnedCommandRequest) => {
      const project = activeProject();
      const item = original(command);
      if (!project || !item) return;
      try {
        const updated = await updatePinnedCommand(project.id, item.id, input);
        pinned = pinned.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
        notify.success("Pinned task updated");
      } catch (error) {
        notify.error(`Could not update pinned command: ${errorMessage(error)}`);
        throw error;
      }
    },
    deletePinned: async (command) => {
      const project = activeProject();
      const item = original(command);
      if (!project || !item) return;
      try {
        await deletePinnedCommand(project.id, item.id);
        pinned = pinned.filter((candidate) => candidate.id !== item.id);
        notify.success("Pinned task deleted");
      } catch (error) {
        notify.error(`Could not remove pinned command: ${errorMessage(error)}`);
        throw error;
      }
    },
    loadLogs: async (taskId, query) => {
      taskState.taskLogs = await getTaskLogs(taskId, query);
    },
  };
  adapter.actions = createTaskPanelActions(() => adapter.model, host);

  $effect(() => {
    const projectId = activeProject()?.id;
    if (projectId === lastLoadedProjectId) return;
    lastLoadedProjectId = projectId;
    pinned = [];
    if (!projectId) return;
    loadingPinned = true;
    void getPinnedCommands(projectId)
      .then((commands) => {
        if (activeProject()?.id === projectId) pinned = commands;
      })
      .catch((error) =>
        notify.error(`Could not load pinned commands: ${errorMessage(error)}`),
      )
      .finally(() => {
        if (activeProject()?.id === projectId) loadingPinned = false;
      });
  });

  return adapter;
}
