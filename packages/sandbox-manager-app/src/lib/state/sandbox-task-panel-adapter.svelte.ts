import type {
  CreatePinnedCommandRequest,
  ManagedSandboxRecord,
  SandboxPinnedCommand,
  StartTaskRequest,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { writeClipboardText } from "@nervekit/ui-kit/core/clipboard";
import { notify } from "@nervekit/ui-kit/core/notify";
import {
  createTaskPanelActions,
  disabledCapability,
  enabledCapability,
  normalizePinnedCommand,
  type NormalizedPinnedCommand,
  type TaskPanelActions,
  type TaskPanelModel,
} from "@nervekit/workbench-ui";
import { sandboxCanForwardCommand } from "./sandbox-lifecycle";
import type { SandboxManagerStore } from "./sandbox-manager-state.svelte";
import type { SandboxDetailState } from "./sandbox-ui-types";

const disconnected = disabledCapability(
  "Start or reconnect the sandbox to manage live tasks.",
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSandboxTaskPanelAdapter(
  store: SandboxManagerStore,
  record: () => ManagedSandboxRecord,
  detail: () => SandboxDetailState | undefined,
): { readonly model: TaskPanelModel; readonly actions: TaskPanelActions } {
  let loadedSandboxId = $state<string | undefined>(undefined);
  let runningPinnedId = $state<string | undefined>(undefined);
  const connected = () => sandboxCanForwardCommand(record(), detail());

  const adapter = {
    get model(): TaskPanelModel {
      const state = detail();
      const liveCapability = connected() ? enabledCapability : disconnected;
      const selectedTask = state?.tasks.find(
        (task) => task.id === state.selectedTaskId,
      );
      return {
        availability: { available: true },
        notice: connected()
          ? undefined
          : "Pinned commands are available while stopped. Start or reconnect the sandbox to run commands and manage live tasks.",
        tasks: state?.tasks ?? [],
        selectedTask,
        selectedLogs: state?.selectedTaskId
          ? state.taskLogsById[state.selectedTaskId]
          : undefined,
        logsLoading: false,
        pinnedCommands: (state?.pinnedCommands ?? []).map(
          normalizePinnedCommand,
        ),
        defaultCwd: "/workspace",
        pinnedLoading: state?.pinnedCommandsLoading ?? false,
        runningPinnedId,
        capabilities: {
          start: liveCapability,
          cancel: liveCapability,
          restart: liveCapability,
          remove: liveCapability,
          prune: liveCapability,
          pin: enabledCapability,
          copy: enabledCapability,
          logs: liveCapability,
          managePinned: enabledCapability,
        },
      };
    },
    actions: undefined as unknown as TaskPanelActions,
  };

  function original(
    command: NormalizedPinnedCommand,
  ): SandboxPinnedCommand | undefined {
    return detail()?.pinnedCommands.find((item) => item.id === command.id);
  }

  const host: TaskPanelActions = {
    selectTask: (taskId) => {
      const state = detail();
      if (state) state.selectedTaskId = taskId;
    },
    openTaskOutput: (taskId) =>
      store.openWorkspaceTaskOutput(record().sandboxId, taskId),
    startTask: (request: StartTaskRequest) =>
      store.runSandboxTask(record().sandboxId, request),
    runPinned: async (command) => {
      runningPinnedId = command.id;
      try {
        await store.runSandboxTask(record().sandboxId, {
          command: command.command,
          name: command.label ?? command.command,
          cwd: command.cwd ?? "/workspace",
        });
      } catch (error) {
        notify.error("Could not start task", {
          description: errorMessage(error),
        });
      } finally {
        window.setTimeout(() => {
          if (runningPinnedId === command.id) runningPinnedId = undefined;
        }, 800);
      }
    },
    cancelTask: (taskId) => store.cancelSandboxTask(record().sandboxId, taskId),
    restartTask: (taskId) =>
      store.restartSandboxTask(record().sandboxId, taskId),
    removeTask: (taskId) => store.removeSandboxTask(record().sandboxId, taskId),
    pruneTasks: () => store.pruneSandboxTasks(record().sandboxId),
    pinTask: async (task) => {
      try {
        await store.createSandboxPinnedCommand(record().sandboxId, {
          command: task.command,
          label: task.name,
          cwd: task.cwd === "/workspace" ? undefined : task.cwd,
        });
        notify.success("Command pinned");
      } catch (error) {
        notify.error("Could not pin command", {
          description: errorMessage(error),
        });
      }
    },
    copyCommand: async (command) => {
      try {
        await writeClipboardText(command);
        notify.success("Copied command");
      } catch {
        notify.error("Could not copy command");
      }
    },
    createPinned: async (input: CreatePinnedCommandRequest) => {
      try {
        await store.createSandboxPinnedCommand(record().sandboxId, input);
        notify.success("Command pinned");
      } catch (error) {
        notify.error("Could not pin command", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    updatePinned: async (command, input: UpdatePinnedCommandRequest) => {
      const item = original(command);
      if (!item) return;
      try {
        await store.updateSandboxPinnedCommand(record().sandboxId, item, input);
        notify.success("Pinned task updated");
      } catch (error) {
        notify.error("Could not update pinned command", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    deletePinned: async (command) => {
      const item = original(command);
      if (!item) return;
      try {
        await store.deleteSandboxPinnedCommand(record().sandboxId, item);
        notify.success("Pinned task deleted");
      } catch (error) {
        notify.error("Could not delete pinned command", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    loadLogs: (taskId) =>
      store.refreshSandboxTaskLogs(record().sandboxId, taskId),
  };
  adapter.actions = createTaskPanelActions(() => adapter.model, host);

  $effect(() => {
    const sandboxId = record().sandboxId;
    if (loadedSandboxId === sandboxId) return;
    loadedSandboxId = sandboxId;
    void store.refreshSandboxPinnedCommands(sandboxId).catch((error) =>
      notify.error("Could not load pinned commands", {
        description: errorMessage(error),
      }),
    );
    if (connected())
      void store.refreshSandboxTasks(sandboxId).catch(() => undefined);
  });

  $effect(() => {
    if (!connected()) return;
    const sandboxId = record().sandboxId;
    const state = detail();
    const hasRunning = state?.tasks.some((task) =>
      ["starting", "running", "ready", "stopping"].includes(task.status),
    );
    const interval = window.setInterval(
      () => {
        if (document.visibilityState !== "visible") return;
        void store.refreshSandboxTasks(sandboxId).catch(() => undefined);
      },
      hasRunning ? 1_500 : 5_000,
    );
    return () => window.clearInterval(interval);
  });

  return adapter;
}
