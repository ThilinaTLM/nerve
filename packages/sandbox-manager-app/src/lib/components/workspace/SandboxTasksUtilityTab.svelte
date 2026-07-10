<script lang="ts">
import type {
  CreatePinnedCommandRequest,
  ManagedSandboxRecord,
  SandboxPinnedCommand,
  TaskRecord,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { writeClipboardText } from "@nervekit/workbench-ui/core/clipboard";
import { notify } from "@nervekit/workbench-ui/core/notify";
import TaskUtilityPanelView from "@nervekit/workbench-ui/tasks/TaskUtilityPanelView.svelte";
import { sandboxCanForwardCommand } from "../../state/sandbox-lifecycle";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import type { SandboxDetailState } from "../../state/sandbox-ui-types";

let {
  record,
  detail,
}: {
  record: ManagedSandboxRecord;
  detail?: SandboxDetailState;
} = $props();

const store = useSandboxManagerStore();
const connected = $derived(sandboxCanForwardCommand(record, detail));
const selectedTask = $derived(
  detail?.tasks.find((task) => task.id === detail?.selectedTaskId),
);
const runningTasks = $derived(
  detail?.tasks.filter((task) =>
    ["starting", "running", "ready", "stopping"].includes(task.status),
  ) ?? [],
);

let loadedSandboxId = $state<string | undefined>(undefined);
let runningPinnedId = $state<string | undefined>(undefined);

$effect(() => {
  if (loadedSandboxId === record.sandboxId) return;
  loadedSandboxId = record.sandboxId;
  void store.refreshSandboxPinnedCommands(record.sandboxId).catch((error) =>
    notify.error("Could not load pinned commands", {
      description: errorMessage(error),
    }),
  );
  if (connected)
    void store.refreshSandboxTasks(record.sandboxId).catch(() => undefined);
});

$effect(() => {
  if (!connected) return;
  const interval = window.setInterval(
    () => {
      void store.refreshSandboxTasks(record.sandboxId).catch(() => undefined);
      const taskId = detail?.selectedTaskId;
      if (taskId)
        void store
          .refreshSandboxTaskLogs(record.sandboxId, taskId)
          .catch(() => undefined);
    },
    runningTasks.length > 0 ? 1500 : 5000,
  );
  return () => window.clearInterval(interval);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyCommand(command: string): Promise<void> {
  try {
    await writeClipboardText(command);
    notify.success("Copied command");
  } catch {
    notify.error("Could not copy command");
  }
}

async function pinTask(task: TaskRecord): Promise<void> {
  try {
    await store.createSandboxPinnedCommand(record.sandboxId, {
      command: task.command,
      label: task.name,
      cwd: task.cwd === "/workspace" ? undefined : task.cwd,
    });
    notify.success("Command pinned");
  } catch (error) {
    notify.error("Could not pin command", { description: errorMessage(error) });
  }
}

async function runPinned(command: SandboxPinnedCommand): Promise<void> {
  if (!connected) return;
  runningPinnedId = command.id;
  try {
    await store.runSandboxTask(record.sandboxId, {
      command: command.command,
      name: command.label ?? command.command,
      cwd: command.cwd ?? "/workspace",
    });
  } catch (error) {
    notify.error("Could not start task", { description: errorMessage(error) });
  } finally {
    window.setTimeout(() => {
      if (runningPinnedId === command.id) runningPinnedId = undefined;
    }, 800);
  }
}

async function createPinned(input: CreatePinnedCommandRequest): Promise<void> {
  try {
    await store.createSandboxPinnedCommand(record.sandboxId, input);
    notify.success("Command pinned");
  } catch (error) {
    notify.error("Could not pin command", { description: errorMessage(error) });
    throw error;
  }
}

async function updatePinned(
  command: SandboxPinnedCommand,
  input: UpdatePinnedCommandRequest,
): Promise<void> {
  try {
    await store.updateSandboxPinnedCommand(record.sandboxId, command, input);
    notify.success("Pinned task updated");
  } catch (error) {
    notify.error("Could not update pinned command", {
      description: errorMessage(error),
    });
    throw error;
  }
}

async function deletePinned(command: SandboxPinnedCommand): Promise<void> {
  try {
    await store.deleteSandboxPinnedCommand(record.sandboxId, command);
    notify.success("Pinned task deleted");
  } catch (error) {
    notify.error("Could not delete pinned command", {
      description: errorMessage(error),
    });
    throw error;
  }
}
</script>

<TaskUtilityPanelView
  unavailableMessage={connected
    ? undefined
    : "Pinned commands are available while stopped. Start or reconnect the sandbox to run commands and manage live tasks."}
  defaultCwd="/workspace"
  tasks={detail?.tasks ?? []}
  pinned={detail?.pinnedCommands ?? []}
  {selectedTask}
  loadingPinned={detail?.pinnedCommandsLoading ?? false}
  {runningPinnedId}
  disablePinnedRun={!connected}
  onOpenTaskOutput={(id) => store.openWorkspaceTaskOutput(record.sandboxId, id)}
  onCancelTask={(id) => void store.cancelSandboxTask(record.sandboxId, id)}
  onRestartTask={(id) => void store.restartSandboxTask(record.sandboxId, id)}
  onRemoveTask={(id) => void store.removeSandboxTask(record.sandboxId, id)}
  onPruneTasks={() => void store.pruneSandboxTasks(record.sandboxId)}
  onPinTask={(task) => void pinTask(task)}
  onCopyCommand={(command) => void copyCommand(command)}
  onRunPinned={(command) => void runPinned(command as SandboxPinnedCommand)}
  onCreatePinned={(input) => createPinned(input)}
  onUpdatePinned={(command, input) =>
    updatePinned(command as SandboxPinnedCommand, input)}
  onDeletePinned={(command) => deletePinned(command as SandboxPinnedCommand)}
/>
