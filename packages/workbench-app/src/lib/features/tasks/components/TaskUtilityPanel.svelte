<script lang="ts">
import Pin from "@lucide/svelte/icons/pin";
import Play from "@lucide/svelte/icons/play";
import Plus from "@lucide/svelte/icons/plus";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import {
  createPinnedCommand,
  deletePinnedCommand,
  getPinnedCommands,
  updatePinnedCommand,
  type CreatePinnedCommandRequest,
  type PinnedCommand,
  type UpdatePinnedCommandRequest,
  type TaskRecord,
  type ProjectRecord,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import PinnedCommandDialog from "@nervekit/workbench-ui/tasks/PinnedCommandDialog.svelte";
import PinnedCommandItem from "@nervekit/workbench-ui/tasks/PinnedCommandItem.svelte";
import TaskListItem from "@nervekit/workbench-ui/tasks/TaskListItem.svelte";

type Props = {
  activeProject?: ProjectRecord;
  tasks?: TaskRecord[];
  selectedTask?: TaskRecord;
  homeDir?: string;
  onOpenTaskOutput?: (id: string) => void;
  onCancelTask?: (id: string) => void;
  onRestartTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
  onPruneTasks?: () => void;
  onRunCommand?: (input: {
    projectId: string;
    cwd: string;
    command: string;
    name?: string;
  }) => void;
};

let {
  activeProject,
  tasks = [],
  selectedTask,
  onOpenTaskOutput,
  onCancelTask,
  onRestartTask,
  onRemoveTask,
  onPruneTasks,
  onRunCommand,
}: Props = $props();

const ACTIVE = new Set(["starting", "running", "ready", "stopping"]);
const isActive = (task: TaskRecord) => ACTIVE.has(task.status);

const running = $derived(tasks.filter(isActive));
const hasRunningTasks = $derived(running.length > 0);
const orphaned = $derived(tasks.filter((task) => task.status === "orphaned"));
const finished = $derived(
  tasks.filter((task) => !isActive(task) && task.status !== "orphaned"),
);

let pinnedSectionOpen = $state(true);
let previousHasRunningTasks = $state<boolean | undefined>(undefined);
let runningSectionOpen = $state(true);
let orphanedSectionOpen = $state(true);
let finishedSectionOpen = $state(false);
let confirmPruneOpen = $state(false);

let pinned = $state<PinnedCommand[]>([]);
let loadingPinned = $state(false);
let addPinOpen = $state(false);
let savingPin = $state(false);
let runningPinId = $state<string | undefined>(undefined);
let pinToDelete = $state<PinnedCommand | undefined>(undefined);
let pinToEdit = $state<PinnedCommand | undefined>(undefined);
let editPinOpen = $state(false);
let savingEditPin = $state(false);
let lastLoadedProjectId = $state<string | undefined>(undefined);

$effect(() => {
  const current = hasRunningTasks;
  if (previousHasRunningTasks === current) return;
  previousHasRunningTasks = current;
  pinnedSectionOpen = !current;
});

$effect(() => {
  const projectId = activeProject?.id;
  if (projectId === lastLoadedProjectId) return;
  lastLoadedProjectId = projectId;
  pinned = [];
  if (!projectId) return;
  loadingPinned = true;
  void getPinnedCommands(projectId)
    .then((commands) => {
      if (activeProject?.id === projectId) pinned = commands;
    })
    .catch((error) =>
      notify.error(`Could not load pinned commands: ${errorMessage(error)}`),
    )
    .finally(() => {
      if (activeProject?.id === projectId) loadingPinned = false;
    });
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyToClipboard(text: string, label: string) {
  try {
    await writeClipboardText(text);
    notify.success(`Copied ${label}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

async function pinFromTask(task: TaskRecord) {
  if (!activeProject) return;
  try {
    const created = await createPinnedCommand(activeProject.id, {
      command: task.command,
      label: task.name,
      cwd: task.cwd === activeProject.dir ? undefined : task.cwd,
    });
    pinned = [...pinned, created];
    pinnedSectionOpen = true;
    notify.success("Command pinned");
  } catch (error) {
    notify.error(`Could not pin command: ${errorMessage(error)}`);
  }
}

async function createPin(input: CreatePinnedCommandRequest) {
  if (!activeProject) return;
  savingPin = true;
  try {
    const created = await createPinnedCommand(activeProject.id, input);
    pinned = [...pinned, created];
    addPinOpen = false;
    pinnedSectionOpen = true;
    notify.success("Command pinned");
  } catch (error) {
    notify.error(`Could not pin command: ${errorMessage(error)}`);
  } finally {
    savingPin = false;
  }
}

async function removePin(command: PinnedCommand | undefined) {
  if (!activeProject || !command) return;
  try {
    await deletePinnedCommand(activeProject.id, command.id);
    pinned = pinned.filter((item) => item.id !== command.id);
    pinToDelete = undefined;
    notify.success("Pinned task deleted");
  } catch (error) {
    notify.error(`Could not remove pinned command: ${errorMessage(error)}`);
  }
}

function editPin(command: PinnedCommand) {
  pinToEdit = command;
  editPinOpen = true;
}

async function savePinEdit(input: UpdatePinnedCommandRequest) {
  if (!activeProject || !pinToEdit) return;
  savingEditPin = true;
  try {
    const updated = await updatePinnedCommand(
      activeProject.id,
      pinToEdit.id,
      input,
    );
    pinned = pinned.map((item) => (item.id === updated.id ? updated : item));
    editPinOpen = false;
    pinToEdit = undefined;
    notify.success("Pinned task updated");
  } catch (error) {
    notify.error(`Could not update pinned command: ${errorMessage(error)}`);
  } finally {
    savingEditPin = false;
  }
}

function runPin(command: PinnedCommand) {
  if (!activeProject) return;
  runningPinId = command.id;
  onRunCommand?.({
    projectId: activeProject.id,
    cwd: command.cwd ?? activeProject.dir,
    command: command.command,
    name: command.label ?? command.command,
  });
  window.setTimeout(() => {
    if (runningPinId === command.id) runningPinId = undefined;
  }, 1200);
}
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <div class="flex flex-col gap-2 p-2">
    {#if !activeProject}
      <p class="px-1 py-6 text-center text-xs text-muted-foreground">
        Select a project to manage its tasks.
      </p>
    {:else}
      <PanelSection title="Pinned" icon={Pin} bind:open={pinnedSectionOpen}>
        {#snippet meta()}<span class="font-mono">{pinned.length}</span
          >{/snippet}
        {#snippet actions()}
          <button
            class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            title="Pin a command"
            aria-label="Pin a command"
            type="button"
            onclick={() => (addPinOpen = true)}
          >
            <Plus size={13} strokeWidth={2.3} />
          </button>
        {/snippet}
        <div class="flex flex-col gap-1.5">
          {#if loadingPinned && pinned.length === 0}
            <p class="px-1 py-1 text-xs text-muted-foreground">Loading…</p>
          {:else if pinned.length === 0}
            <p class="px-1 py-1 text-xs text-muted-foreground">
              No pinned commands. Add one to run it anytime.
            </p>
          {:else}
            {#each pinned as command (command.id)}
              <PinnedCommandItem
                {command}
                cwd={activeProject.dir}
                running={runningPinId === command.id}
                onRun={(item) => runPin(item as PinnedCommand)}
                onEdit={(item) => editPin(item as PinnedCommand)}
                onRemove={(item) => (pinToDelete = item as PinnedCommand)}
              />
            {/each}
          {/if}
        </div>
      </PanelSection>

      {#if running.length > 0}
        <PanelSection
          title="Running"
          icon={Play}
          bind:open={runningSectionOpen}
        >
          {#snippet meta()}<span class="font-mono">{running.length}</span
            >{/snippet}
          <div class="flex flex-col gap-1.5">
            {#each running as task (task.id)}
              <TaskListItem
                {task}
                selected={task.id === selectedTask?.id}
                {onOpenTaskOutput}
                {onCancelTask}
                {onRestartTask}
                {onRemoveTask}
                onPinTask={(item) => void pinFromTask(item)}
                onCopyCommand={(command) =>
                  void copyToClipboard(command, "command")}
              />
            {/each}
          </div>
        </PanelSection>
      {/if}

      {#if orphaned.length > 0}
        <PanelSection
          title="Needs cleanup"
          icon={TriangleAlert}
          bind:open={orphanedSectionOpen}
        >
          {#snippet meta()}<span class="font-mono">{orphaned.length}</span
            >{/snippet}
          <div class="flex flex-col gap-1.5">
            {#each orphaned as task (task.id)}
              <TaskListItem
                {task}
                selected={task.id === selectedTask?.id}
                {onOpenTaskOutput}
                {onCancelTask}
                {onRestartTask}
                {onRemoveTask}
                onPinTask={(item) => void pinFromTask(item)}
                onCopyCommand={(command) =>
                  void copyToClipboard(command, "command")}
              />
            {/each}
          </div>
        </PanelSection>
      {/if}

      {#if finished.length > 0}
        <PanelSection
          title="Finished"
          icon={Square}
          bind:open={finishedSectionOpen}
        >
          {#snippet meta()}<span class="font-mono">{finished.length}</span
            >{/snippet}
          {#snippet actions()}
            <Button
              size="xs"
              variant="ghost"
              class="h-6 gap-1 text-muted-foreground hover:text-destructive"
              onclick={() => (confirmPruneOpen = true)}
            >
              <Trash2 size={12} strokeWidth={2.3} />Prune
            </Button>
          {/snippet}
          <div class="flex flex-col gap-1.5">
            {#each finished as task (task.id)}
              <TaskListItem
                {task}
                selected={task.id === selectedTask?.id}
                {onOpenTaskOutput}
                {onCancelTask}
                {onRestartTask}
                {onRemoveTask}
                onPinTask={(item) => void pinFromTask(item)}
                onCopyCommand={(command) =>
                  void copyToClipboard(command, "command")}
              />
            {/each}
          </div>
        </PanelSection>
      {/if}
    {/if}
  </div>
</Tooltip.Provider>

<PinnedCommandDialog
  bind:open={addPinOpen}
  projectCwd={activeProject?.dir}
  saving={savingPin}
  onSave={(input) => void createPin(input)}
/>

<PinnedCommandDialog
  bind:open={editPinOpen}
  command={pinToEdit}
  projectCwd={activeProject?.dir}
  saving={savingEditPin}
  onSave={(input) => void savePinEdit(input)}
  onOpenChange={(open) => {
    if (!open) pinToEdit = undefined;
  }}
/>

<ConfirmDialog
  open={Boolean(pinToDelete)}
  destructive
  title="Delete pinned task?"
  description={`This removes the pinned task "${pinToDelete?.label ?? pinToDelete?.command ?? ""}". Running tasks and captured logs are not removed.`}
  confirmLabel="Delete"
  onConfirm={() => void removePin(pinToDelete)}
  onCancel={() => (pinToDelete = undefined)}
  onOpenChange={(open) => {
    if (!open) pinToDelete = undefined;
  }}
/>

<ConfirmDialog
  bind:open={confirmPruneOpen}
  destructive
  title="Prune finished tasks"
  description={`This removes ${finished.length} finished ${finished.length === 1 ? "task" : "tasks"} and their captured logs. This can't be undone.`}
  confirmLabel="Prune"
  onConfirm={() => onPruneTasks?.()}
/>
