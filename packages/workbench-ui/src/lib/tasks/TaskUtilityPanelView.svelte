<script lang="ts">
import Pin from "@lucide/svelte/icons/pin";
import Play from "@lucide/svelte/icons/play";
import Plus from "@lucide/svelte/icons/plus";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  CreatePinnedCommandRequest,
  PinnedCommand,
  SandboxPinnedCommand,
  TaskRecord,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { Button } from "@nervekit/workbench-ui/components/ui/button";
import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/workbench-ui/components/ui/tooltip";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
import PinnedCommandDialog from "./PinnedCommandDialog.svelte";
import PinnedCommandItem from "./PinnedCommandItem.svelte";
import TaskListItem from "./TaskListItem.svelte";

type AnyPinnedCommand = PinnedCommand | SandboxPinnedCommand;
type SavePinnedCommandRequest =
  | CreatePinnedCommandRequest
  | UpdatePinnedCommandRequest;

type Props = {
  unavailableMessage?: string;
  defaultCwd?: string;
  tasks?: TaskRecord[];
  pinned?: AnyPinnedCommand[];
  selectedTask?: TaskRecord;
  loadingPinned?: boolean;
  runningPinnedId?: string;
  disablePinnedRun?: boolean;
  onOpenTaskOutput?: (id: string) => void;
  onCancelTask?: (id: string) => void;
  onRestartTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
  onPruneTasks?: () => void;
  onPinTask?: (task: TaskRecord) => void;
  onCopyCommand?: (command: string) => void;
  onRunPinned?: (command: AnyPinnedCommand) => void;
  onCreatePinned?: (input: CreatePinnedCommandRequest) => Promise<void> | void;
  onUpdatePinned?: (
    command: AnyPinnedCommand,
    input: UpdatePinnedCommandRequest,
  ) => Promise<void> | void;
  onDeletePinned?: (command: AnyPinnedCommand) => Promise<void> | void;
};

let {
  unavailableMessage,
  defaultCwd,
  tasks = [],
  pinned = [],
  selectedTask,
  loadingPinned = false,
  runningPinnedId,
  disablePinnedRun = false,
  onOpenTaskOutput,
  onCancelTask,
  onRestartTask,
  onRemoveTask,
  onPruneTasks,
  onPinTask,
  onCopyCommand,
  onRunPinned,
  onCreatePinned,
  onUpdatePinned,
  onDeletePinned,
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

let addPinOpen = $state(false);
let savingPin = $state(false);
let pinToDelete = $state<AnyPinnedCommand | undefined>(undefined);
let pinToEdit = $state<AnyPinnedCommand | undefined>(undefined);
let editPinOpen = $state(false);
let savingEditPin = $state(false);

$effect(() => {
  const current = hasRunningTasks;
  if (previousHasRunningTasks === current) return;
  previousHasRunningTasks = current;
  pinnedSectionOpen = !current;
});

async function createPin(input: SavePinnedCommandRequest) {
  savingPin = true;
  try {
    await onCreatePinned?.(input as CreatePinnedCommandRequest);
    addPinOpen = false;
    pinnedSectionOpen = true;
  } finally {
    savingPin = false;
  }
}

function editPin(command: AnyPinnedCommand) {
  pinToEdit = command;
  editPinOpen = true;
}

async function savePinEdit(input: SavePinnedCommandRequest) {
  if (!pinToEdit) return;
  savingEditPin = true;
  try {
    await onUpdatePinned?.(pinToEdit, input as UpdatePinnedCommandRequest);
    editPinOpen = false;
    pinToEdit = undefined;
  } finally {
    savingEditPin = false;
  }
}

async function removePin(command: AnyPinnedCommand | undefined) {
  if (!command) return;
  await onDeletePinned?.(command);
  pinToDelete = undefined;
}
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <div class="flex flex-col gap-2 p-2">
    {#if unavailableMessage}
      <p
        class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground"
      >
        {unavailableMessage}
      </p>
    {/if}

    <PanelSection title="Pinned" icon={Pin} bind:open={pinnedSectionOpen}>
      {#snippet meta()}<span class="font-mono">{pinned.length}</span>{/snippet}
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
              cwd={defaultCwd}
              running={runningPinnedId === command.id}
              disabled={disablePinnedRun}
              onRun={onRunPinned}
              onEdit={editPin}
              onRemove={(item) => (pinToDelete = item)}
            />
          {/each}
        {/if}
      </div>
    </PanelSection>

    {#if running.length > 0}
      <PanelSection title="Running" icon={Play} bind:open={runningSectionOpen}>
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
              {onPinTask}
              {onCopyCommand}
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
              {onPinTask}
              {onCopyCommand}
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
              {onPinTask}
              {onCopyCommand}
            />
          {/each}
        </div>
      </PanelSection>
    {/if}
  </div>
</Tooltip.Provider>

<PinnedCommandDialog
  bind:open={addPinOpen}
  projectCwd={defaultCwd}
  saving={savingPin}
  onSave={(input) => void createPin(input)}
/>

<PinnedCommandDialog
  bind:open={editPinOpen}
  command={pinToEdit}
  projectCwd={defaultCwd}
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
