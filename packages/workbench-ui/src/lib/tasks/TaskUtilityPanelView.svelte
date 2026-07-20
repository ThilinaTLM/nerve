<script lang="ts">
import Pin from "@lucide/svelte/icons/pin";
import Play from "@lucide/svelte/icons/play";
import Plus from "@lucide/svelte/icons/plus";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  CreatePinnedCommandRequest,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
import PinnedCommandDialog from "./PinnedCommandDialog.svelte";
import PinnedCommandItem from "./PinnedCommandItem.svelte";
import TaskListItem from "./TaskListItem.svelte";
import { groupTasks } from "./task-panel-controller.js";
import {
  defaultTaskPanelSectionState,
  type NormalizedPinnedCommand,
  type TaskPanelActions,
  type TaskPanelModel,
  type TaskPanelSectionState,
} from "./task-panel-types.js";

let {
  model,
  actions: panelActions,
  sectionState = defaultTaskPanelSectionState,
  onSectionOpenChange,
}: {
  model: TaskPanelModel;
  actions: TaskPanelActions;
  sectionState?: TaskPanelSectionState;
  onSectionOpenChange?: (
    section: keyof TaskPanelSectionState,
    open: boolean,
  ) => void;
} = $props();

const groups = $derived(groupTasks(model.tasks));
let confirmPruneOpen = $state(false);
let addPinOpen = $state(false);
let savingPin = $state(false);
let pinToDelete = $state<NormalizedPinnedCommand | undefined>(undefined);
let pinToEdit = $state<NormalizedPinnedCommand | undefined>(undefined);
let editPinOpen = $state(false);
let savingEditPin = $state(false);

async function createPin(input: CreatePinnedCommandRequest): Promise<void> {
  savingPin = true;
  try {
    await panelActions.createPinned(input);
    addPinOpen = false;
    onSectionOpenChange?.("pinned", true);
  } finally {
    savingPin = false;
  }
}

function editPin(command: NormalizedPinnedCommand): void {
  pinToEdit = command;
  editPinOpen = true;
}

async function savePinEdit(input: UpdatePinnedCommandRequest): Promise<void> {
  if (!pinToEdit) return;
  savingEditPin = true;
  try {
    await panelActions.updatePinned(pinToEdit, input);
    editPinOpen = false;
    pinToEdit = undefined;
  } finally {
    savingEditPin = false;
  }
}

async function removePin(
  command: NormalizedPinnedCommand | undefined,
): Promise<void> {
  if (!command) return;
  await panelActions.deletePinned(command);
  pinToDelete = undefined;
}
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <div class="flex flex-col gap-2 p-2">
    {#if !model.availability.available}
      <p
        class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground"
      >
        {model.availability.message}
      </p>
    {/if}
    {#if model.notice}
      <p
        class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground"
      >
        {model.notice}
      </p>
    {/if}

    <PanelSection
      title="Pinned"
      icon={Pin}
      open={sectionState.pinned}
      onOpenChange={(open) => onSectionOpenChange?.("pinned", open)}
    >
      {#snippet meta()}<span class="font-mono"
          >{model.pinnedCommands.length}</span
        >{/snippet}
      {#snippet actions()}
        <button
          class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          title={model.capabilities.managePinned.enabled
            ? "Pin a command"
            : model.capabilities.managePinned.reason}
          aria-label="Pin a command"
          type="button"
          disabled={!model.capabilities.managePinned.enabled}
          onclick={() => (addPinOpen = true)}
        >
          <Plus size={13} strokeWidth={2.3} />
        </button>
      {/snippet}
      <div class="flex flex-col gap-1.5">
        {#if model.pinnedLoading && model.pinnedCommands.length === 0}
          <p class="px-1 py-1 text-xs text-muted-foreground">Loading…</p>
        {:else if model.pinnedCommands.length === 0}
          <p class="px-1 py-1 text-xs text-muted-foreground">
            No pinned commands. Add one to run it anytime.
          </p>
        {:else}
          {#each model.pinnedCommands as command (command.id)}
            <PinnedCommandItem
              {command}
              cwd={model.defaultCwd}
              running={model.runningPinnedId === command.id}
              runCapability={model.capabilities.start}
              manageCapability={model.capabilities.managePinned}
              onRun={(item) => void panelActions.runPinned(item)}
              onEdit={editPin}
              onRemove={(item) => (pinToDelete = item)}
            />
          {/each}
        {/if}
      </div>
    </PanelSection>

    <PanelSection
      title="Running"
      icon={Play}
      open={sectionState.running}
      onOpenChange={(open) => onSectionOpenChange?.("running", open)}
    >
      {#snippet meta()}<span class="font-mono">{groups.running.length}</span
        >{/snippet}
      <div class="flex flex-col gap-1.5">
        {#if groups.running.length === 0}
          <p class="px-1 py-1 text-xs text-muted-foreground">
            No running tasks.
          </p>
        {:else}
          {#each groups.running as task (task.id)}
            <TaskListItem
              {task}
              selected={task.id === model.selectedTask?.id}
              capabilities={model.capabilities}
              onOpenTaskOutput={(id) => void panelActions.openTaskOutput(id)}
              onCancelTask={(id) => void panelActions.cancelTask(id)}
              onRestartTask={(id) => void panelActions.restartTask(id)}
              onRemoveTask={(id) => void panelActions.removeTask(id)}
              onPinTask={(item) => void panelActions.pinTask(item)}
              onCopyCommand={(command) =>
                void panelActions.copyCommand(command)}
            />
          {/each}
        {/if}
      </div>
    </PanelSection>

    <PanelSection
      title="Needs cleanup"
      icon={TriangleAlert}
      open={sectionState.needsCleanup}
      onOpenChange={(open) => onSectionOpenChange?.("needsCleanup", open)}
    >
      {#snippet meta()}<span class="font-mono">{groups.orphaned.length}</span
        >{/snippet}
      <div class="flex flex-col gap-1.5">
        {#if groups.orphaned.length === 0}
          <p class="px-1 py-1 text-xs text-muted-foreground">
            No tasks need cleanup.
          </p>
        {:else}
          {#each groups.orphaned as task (task.id)}
            <TaskListItem
              {task}
              selected={task.id === model.selectedTask?.id}
              capabilities={model.capabilities}
              onOpenTaskOutput={(id) => void panelActions.openTaskOutput(id)}
              onCancelTask={(id) => void panelActions.cancelTask(id)}
              onRestartTask={(id) => void panelActions.restartTask(id)}
              onRemoveTask={(id) => void panelActions.removeTask(id)}
              onPinTask={(item) => void panelActions.pinTask(item)}
              onCopyCommand={(command) =>
                void panelActions.copyCommand(command)}
            />
          {/each}
        {/if}
      </div>
    </PanelSection>

    <PanelSection
      title="Finished"
      icon={Square}
      open={sectionState.finished}
      onOpenChange={(open) => onSectionOpenChange?.("finished", open)}
    >
      {#snippet meta()}<span class="font-mono">{groups.finished.length}</span
        >{/snippet}
      {#snippet actions()}
        <Button
          size="xs"
          variant="ghost"
          class="h-6 gap-1 text-muted-foreground hover:text-destructive"
          disabled={!model.capabilities.prune.enabled ||
            groups.finished.length === 0}
          title={model.capabilities.prune.enabled
            ? "Prune finished tasks"
            : model.capabilities.prune.reason}
          onclick={() => (confirmPruneOpen = true)}
        >
          <Trash2 size={12} strokeWidth={2.3} />Prune
        </Button>
      {/snippet}
      <div class="flex flex-col gap-1.5">
        {#if groups.finished.length === 0}
          <p class="px-1 py-1 text-xs text-muted-foreground">
            No finished tasks.
          </p>
        {:else}
          {#each groups.finished as task (task.id)}
            <TaskListItem
              {task}
              selected={task.id === model.selectedTask?.id}
              capabilities={model.capabilities}
              onOpenTaskOutput={(id) => void panelActions.openTaskOutput(id)}
              onCancelTask={(id) => void panelActions.cancelTask(id)}
              onRestartTask={(id) => void panelActions.restartTask(id)}
              onRemoveTask={(id) => void panelActions.removeTask(id)}
              onPinTask={(item) => void panelActions.pinTask(item)}
              onCopyCommand={(command) =>
                void panelActions.copyCommand(command)}
            />
          {/each}
        {/if}
      </div>
    </PanelSection>
  </div>
</Tooltip.Provider>
<PinnedCommandDialog
  bind:open={addPinOpen}
  projectCwd={model.defaultCwd}
  saving={savingPin}
  onSave={(input) => void createPin(input)}
/>

<PinnedCommandDialog
  bind:open={editPinOpen}
  command={pinToEdit}
  projectCwd={model.defaultCwd}
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
  description={`This removes ${groups.finished.length} finished ${groups.finished.length === 1 ? "task" : "tasks"} and their captured logs. This can't be undone.`}
  confirmLabel="Prune"
  onConfirm={() => void panelActions.pruneTasks()}
/>
