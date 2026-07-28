<script lang="ts">
import ListTodo from "@lucide/svelte/icons/list-todo";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { SvelteSet } from "svelte/reactivity";
import type {
  CreateTaskDefinitionRequest,
  TaskRecord,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { cn } from "@nervekit/ui-kit/core/utils";
import {
  Handle as PaneResizer,
  Pane,
  PaneGroup,
} from "@nervekit/ui-kit/components/ui/resizable";
import {
  PanelBanner,
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelSectionHeader,
  PanelToolbarButton,
  PanelView,
  createPanelRowFit,
} from "@nervekit/workbench-ui/panel";
import TaskDefinitionDialog from "./TaskDefinitionDialog.svelte";
import TaskDefinitionRow from "./TaskDefinitionRow.svelte";
import TaskOutputPane from "./TaskOutputPane.svelte";
import TaskRunRow from "./TaskRunRow.svelte";
import TaskRunsDialog from "./TaskRunsDialog.svelte";
import { projectTaskPanel, taskLineageRuns } from "./task-panel-controller.js";
import type {
  TaskEntryCapabilities,
  TaskPanelActions,
  TaskPanelDefinition,
  TaskPanelModel,
} from "./task-panel-types.js";

let {
  model,
  actions: panelActions,
}: {
  model: TaskPanelModel;
  actions: TaskPanelActions;
} = $props();

const projected = $derived(projectTaskPanel(model.definitions, model.tasks));
let addOpen = $state(false);
let saving = $state(false);
let confirmPruneOpen = $state(false);
let editDefinition = $state<TaskPanelDefinition | undefined>();
let deleteDefinition = $state<TaskPanelDefinition | undefined>();
let saveSourceTask = $state<TaskRecord | undefined>();
let panelWidth = $state(0);
let runsRegion = $state<HTMLDivElement | null>(null);
let runsFooter = $state<HTMLDivElement | null>(null);
let runsDialogOpen = $state(false);
const expandedDefinitions = new SvelteSet<string>();

function toggleDefinition(id: string): void {
  if (!expandedDefinitions.delete(id)) expandedDefinitions.add(id);
}

// The wide bottom dock can host the run output next to the list.
const SPLIT_MIN_WIDTH = 720;
const splitLayout = $derived(panelWidth >= SPLIT_MIN_WIDTH);
const selectedRuns = $derived(taskLineageRuns(model.tasks, model.selectedTask));
const prunableRuns = $derived(
  projected.runs.filter((entry) => !entry.isActive).length,
);
const runsFit = createPanelRowFit({
  region: () => runsRegion,
  footer: () => runsFooter,
  total: () => projected.runs.length,
});
const visibleRuns = $derived(projected.runs.slice(0, runsFit.count));
const hiddenRuns = $derived(projected.runs.length - visibleRuns.length);
const capabilities = $derived<TaskEntryCapabilities>({
  start: model.capabilities.start.enabled,
  cancel: model.capabilities.cancel.enabled,
  restart: model.capabilities.restart.enabled,
  remove: model.capabilities.remove.enabled,
  logs: model.capabilities.logs.enabled,
  copy: model.capabilities.copy.enabled,
  manageDefinitions: model.capabilities.manageDefinitions.enabled,
});

async function createDefinition(
  input: CreateTaskDefinitionRequest,
): Promise<void> {
  saving = true;
  try {
    await panelActions.createDefinition(input);
    addOpen = false;
    saveSourceTask = undefined;
  } finally {
    saving = false;
  }
}

async function updateDefinition(
  input: UpdateTaskDefinitionRequest,
): Promise<void> {
  if (!editDefinition) return;
  saving = true;
  try {
    await panelActions.updateDefinition(editDefinition, input);
    editDefinition = undefined;
  } finally {
    saving = false;
  }
}

async function removeDefinition(): Promise<void> {
  if (!deleteDefinition) return;
  await panelActions.deleteDefinition(deleteDefinition);
  deleteDefinition = undefined;
}
</script>

{#snippet taskList()}
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div class="flex min-w-0 shrink flex-col overflow-y-auto">
      {#if model.definitionsLoading && model.definitions.length === 0}
        <p class="py-1 text-xs text-muted-foreground">Loading tasks…</p>
      {:else if projected.definitions.length === 0}
        <PanelEmpty
          icon={ListTodo}
          title="No saved tasks"
          description="Create a task to run it anytime."
        />
      {:else}
        <PanelList role="none">
          {#each projected.definitions as entry (entry.key)}
            {@const expanded = expandedDefinitions.has(entry.key)}
            <div
              class={cn(
                "flex min-w-0 flex-col rounded-md border border-transparent",
                expanded && "border-border",
              )}
            >
              <TaskDefinitionRow
                {entry}
                {capabilities}
                {expanded}
                selected={entry.runs.some(
                  (run) => run.run.id === model.selectedTask?.id,
                )}
                onToggleExpanded={() => toggleDefinition(entry.key)}
                onOpen={(id) => void panelActions.openTaskOutput(id)}
                onRun={() => void panelActions.runDefinition(entry.definition)}
                onCancel={(id) => void panelActions.cancelTask(id)}
                onRestart={(id) => void panelActions.restartTask(id)}
                onEdit={() => (editDefinition = entry.definition)}
                onDelete={() => (deleteDefinition = entry.definition)}
                onCopy={(text) => void panelActions.copyText(text)}
              />
              {#if expanded}
                <div class="flex min-w-0 flex-col border-t py-0.5">
                  {#each entry.runs as runEntry (runEntry.key)}
                    <TaskRunRow
                      nested
                      entry={runEntry}
                      {capabilities}
                      selected={runEntry.run.id === model.selectedTask?.id}
                      onOpen={(id) => void panelActions.openTaskOutput(id)}
                      onCancel={(id) => void panelActions.cancelTask(id)}
                      onRestart={(id) => void panelActions.restartTask(id)}
                      onRemove={(id) => void panelActions.removeTask(id)}
                      onCopy={(text) => void panelActions.copyText(text)}
                    />
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </PanelList>
      {/if}
    </div>

    {#if projected.runs.length > 0}
      <div
        bind:this={runsRegion}
        class="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden"
      >
        <PanelSectionHeader title="Runs" count={projected.runs.length}>
          {#snippet actions()}
            <PanelToolbarButton
              icon={Trash2}
              label="Prune history"
              title="Prune finished ad-hoc task runs"
              disabled={!model.capabilities.prune.enabled || prunableRuns === 0}
              onclick={() => (confirmPruneOpen = true)}
            />
          {/snippet}
        </PanelSectionHeader>
        <PanelList ariaLabel="Runs" class="shrink-0">
          {#each visibleRuns as entry (entry.key)}
            <TaskRunRow
              {entry}
              {capabilities}
              selected={entry.run.id === model.selectedTask?.id}
              onOpen={(id) => void panelActions.openTaskOutput(id)}
              onCancel={(id) => void panelActions.cancelTask(id)}
              onRestart={(id) => void panelActions.restartTask(id)}
              onRemove={(id) => void panelActions.removeTask(id)}
              onCopy={(text) => void panelActions.copyText(text)}
              onSaveAsDefinition={(task) => (saveSourceTask = task)}
            />
          {/each}
        </PanelList>
        {#if hiddenRuns > 0}
          <div bind:this={runsFooter} class="mt-auto shrink-0 p-1">
            <Button
              variant="ghost"
              size="xs"
              class="w-full text-muted-foreground"
              onclick={() => (runsDialogOpen = true)}>See More</Button
            >
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<div class="h-full min-h-0" bind:clientWidth={panelWidth}>
  <PanelView scroll={false} padded={false}>
    {#snippet banner()}
      <PanelHeader
        title="Tasks"
        count={model.availability.available
          ? projected.definitions.length
          : undefined}
      >
        {#snippet trailing()}
          {#if model.availability.available}
            <PanelToolbarButton
              icon={Plus}
              label="Create task"
              disabled={!model.capabilities.manageDefinitions.enabled}
              onclick={() => (addOpen = true)}
            />
          {/if}
        {/snippet}
      </PanelHeader>
      {#if !model.availability.available}
        <PanelBanner tone="muted">{model.availability.message}</PanelBanner>
      {:else if model.notice}
        <PanelBanner tone="info">{model.notice}</PanelBanner>
      {/if}
    {/snippet}

    {#if model.availability.available}
      {#if splitLayout}
        <PaneGroup direction="horizontal" class="min-h-0 flex-1">
          <Pane defaultSize={38} minSize={24} maxSize={60}>
            <div class="flex h-full min-h-0 flex-col">
              {@render taskList()}
            </div>
          </Pane>
          <PaneResizer aria-label="Resize task output" />
          <Pane defaultSize={62} minSize={30}>
            <TaskOutputPane
              task={model.selectedTask}
              taskLogs={model.selectedLogs}
              runs={selectedRuns}
              onSelectRun={(taskId) => void panelActions.selectTask(taskId)}
            />
          </Pane>
        </PaneGroup>
      {:else}
        {@render taskList()}
      {/if}
    {/if}
  </PanelView>
</div>

<TaskRunsDialog
  bind:open={runsDialogOpen}
  runs={projected.runs}
  {capabilities}
  selectedTaskId={model.selectedTask?.id}
  onOpen={(id) => void panelActions.openTaskOutput(id)}
  onCancel={(id) => void panelActions.cancelTask(id)}
  onRestart={(id) => void panelActions.restartTask(id)}
  onRemove={(id) => void panelActions.removeTask(id)}
  onCopy={(text) => void panelActions.copyText(text)}
  onSaveAsDefinition={(task) => (saveSourceTask = task)}
/>
<TaskDefinitionDialog
  bind:open={addOpen}
  projectCwd={model.defaultCwd}
  {saving}
  onSave={(input) => void createDefinition(input)}
/>
<TaskDefinitionDialog
  open={Boolean(editDefinition)}
  definition={editDefinition}
  projectCwd={model.defaultCwd}
  {saving}
  onSave={(input) => void updateDefinition(input)}
  onOpenChange={(open) => {
    if (!open) editDefinition = undefined;
  }}
/>
<TaskDefinitionDialog
  open={Boolean(saveSourceTask)}
  projectCwd={model.defaultCwd}
  initial={saveSourceTask
    ? {
        label: saveSourceTask.displayName ?? saveSourceTask.name,
        command: saveSourceTask.command,
        cwd:
          saveSourceTask.cwd === model.defaultCwd
            ? undefined
            : saveSourceTask.cwd,
      }
    : undefined}
  title="Save as task definition"
  description="Create a reusable definition from this run. The run stays linked to it."
  submitLabel="Save task"
  {saving}
  onSave={(input) =>
    saveSourceTask &&
    void createDefinition({ ...input, sourceTaskId: saveSourceTask.id })}
  onOpenChange={(open) => {
    if (!open) saveSourceTask = undefined;
  }}
/>
<ConfirmDialog
  open={Boolean(deleteDefinition)}
  destructive
  title="Delete saved task?"
  description="The saved definition is removed. Existing run history and logs are retained."
  confirmLabel="Delete"
  onConfirm={() => void removeDefinition()}
  onCancel={() => (deleteDefinition = undefined)}
  onOpenChange={(open) => {
    if (!open) deleteDefinition = undefined;
  }}
/>
<ConfirmDialog
  bind:open={confirmPruneOpen}
  destructive
  title="Prune task history"
  description="This removes completed ad-hoc task runs and their captured logs. Saved tasks and recovery warnings are retained."
  confirmLabel="Prune"
  onConfirm={() => void panelActions.pruneTasks()}
/>
