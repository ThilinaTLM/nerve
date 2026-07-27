<script lang="ts">
import ListTodo from "@lucide/svelte/icons/list-todo";
import Plus from "@lucide/svelte/icons/plus";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  CreateTaskDefinitionRequest,
  TaskRecord,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
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
} from "@nervekit/workbench-ui/panel";
import TaskDefinitionDialog from "./TaskDefinitionDialog.svelte";
import TaskDefinitionRow from "./TaskDefinitionRow.svelte";
import TaskOutputPane from "./TaskOutputPane.svelte";
import TaskRunRow from "./TaskRunRow.svelte";
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

// The wide bottom dock can host the run output next to the list.
const SPLIT_MIN_WIDTH = 720;
const splitLayout = $derived(panelWidth >= SPLIT_MIN_WIDTH);
const selectedRuns = $derived(taskLineageRuns(model.tasks, model.selectedTask));
const prunableRuns = $derived(
  projected.runs.filter((entry) => !entry.definition && !entry.isActive).length,
);
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
  <div class="flex min-w-0 flex-col">
    <PanelSectionHeader
      title="Task definitions"
      count={projected.definitions.length}
    />
    {#if model.definitionsLoading && model.definitions.length === 0}
      <p class="py-1 text-xs text-muted-foreground">Loading tasks…</p>
    {:else if projected.definitions.length === 0}
      <PanelEmpty
        icon={ListTodo}
        title="No saved tasks"
        description="Create a task to run it anytime."
      />
    {:else}
      <PanelList ariaLabel="Task definitions">
        {#each projected.definitions as entry (entry.key)}
          <TaskDefinitionRow
            {entry}
            {capabilities}
            selected={entry.runs.some(
              (run) => run.id === model.selectedTask?.id,
            )}
            onOpen={(id) => void panelActions.openTaskOutput(id)}
            onRun={() => void panelActions.runDefinition(entry.definition)}
            onCancel={(id) => void panelActions.cancelTask(id)}
            onRestart={(id) => void panelActions.restartTask(id)}
            onEdit={() => (editDefinition = entry.definition)}
            onDelete={() => (deleteDefinition = entry.definition)}
            onCopy={(text) => void panelActions.copyText(text)}
          />
        {/each}
      </PanelList>
    {/if}

    <PanelSectionHeader title="Task runs" count={projected.runs.length}>
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
    {#if projected.runs.length === 0}
      <PanelEmpty
        icon={Terminal}
        title="No task runs yet"
        description="Runs appear here as tasks and commands start."
      />
    {:else}
      <PanelList ariaLabel="Task runs">
        {#each projected.runs as entry (entry.key)}
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
    {/if}
  </div>
{/snippet}

<div class="h-full min-h-0" bind:clientWidth={panelWidth}>
  <PanelView scroll={!splitLayout} padded={false}>
    {#snippet banner()}
      <PanelHeader title="Tasks">
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
            <div class="h-full min-h-0 overflow-y-auto">
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
