<script lang="ts">
import History from "@lucide/svelte/icons/history";
import ListTodo from "@lucide/svelte/icons/list-todo";
import Plus from "@lucide/svelte/icons/plus";
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
  PanelList,
  PanelSearchInput,
  PanelToolbar,
  PanelToolbarButton,
  PanelToolbarGroup,
  PanelView,
} from "@nervekit/workbench-ui/panel";
import TaskDefinitionDialog from "./TaskDefinitionDialog.svelte";
import TaskEntryItem from "./TaskEntryItem.svelte";
import TaskOutputPane from "./TaskOutputPane.svelte";
import { projectTaskPanelEntries } from "./task-panel-controller.js";
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

const projected = $derived(
  projectTaskPanelEntries(model.definitions, model.tasks),
);
let view = $state<"tasks" | "history">("tasks");
let addOpen = $state(false);
let saving = $state(false);
let confirmPruneOpen = $state(false);
let editDefinition = $state<TaskPanelDefinition | undefined>();
let deleteDefinition = $state<TaskPanelDefinition | undefined>();
let saveSourceTask = $state<TaskRecord | undefined>();
let query = $state("");
let panelWidth = $state(0);

// The wide bottom dock can host the run output next to the list.
const SPLIT_MIN_WIDTH = 720;
const splitLayout = $derived(panelWidth >= SPLIT_MIN_WIDTH);
const entries = $derived(
  (view === "tasks" ? projected.tasks : projected.history).filter((entry) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [
      entry.definition?.label,
      entry.latestRun?.displayName,
      entry.latestRun?.name,
      entry.definition?.command ?? entry.latestRun?.command,
      entry.definition?.cwd ?? entry.latestRun?.cwd,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(needle));
  }),
);
const selectedRuns = $derived(
  projected.tasks
    .concat(projected.history)
    .find((entry) =>
      entry.runs.some((run) => run.id === model.selectedTask?.id),
    )?.runs ?? [],
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
  <PanelList ariaLabel="Tasks" class="py-0.5">
    {#if model.definitionsLoading && model.definitions.length === 0}
      <p class="py-1 text-xs text-muted-foreground">Loading tasks…</p>
    {:else if entries.length === 0}
      <PanelEmpty
        icon={ListTodo}
        title={view === "tasks" ? "No tasks yet" : "No task history"}
        description={view === "tasks"
          ? "Create a task to run it anytime."
          : "Completed ad-hoc runs appear here."}
      />
    {:else}
      {#each entries as entry (entry.key)}
        <TaskEntryItem
          {entry}
          {capabilities}
          selected={entry.runs.some((run) => run.id === model.selectedTask?.id)}
          onOpen={(id) => void panelActions.openTaskOutput(id)}
          onRun={() =>
            entry.definition &&
            void panelActions.runDefinition(entry.definition)}
          onCancel={(id) => void panelActions.cancelTask(id)}
          onRestart={(id) => void panelActions.restartTask(id)}
          onEdit={() => (editDefinition = entry.definition)}
          onDelete={() => (deleteDefinition = entry.definition)}
          onCopy={(text) => void panelActions.copyText(text)}
          onRemoveRun={(id) => void panelActions.removeTask(id)}
          onSaveAsDefinition={(task) => (saveSourceTask = task)}
        />
      {/each}
    {/if}
  </PanelList>
{/snippet}

<div class="h-full min-h-0" bind:clientWidth={panelWidth}>
  <PanelView scroll={!splitLayout} padded={false}>
    {#snippet toolbar()}
      {#if model.availability.available}
        <PanelToolbar>
          <PanelToolbarGroup>
            <PanelToolbarButton
              icon={ListTodo}
              label={`Tasks (${projected.tasks.length})`}
              showLabel
              active={view === "tasks"}
              onclick={() => (view = "tasks")}
            />
            <PanelToolbarButton
              icon={History}
              label={`History (${projected.history.length})`}
              showLabel
              active={view === "history"}
              onclick={() => (view = "history")}
            />
          </PanelToolbarGroup>
          <PanelSearchInput
            bind:value={query}
            placeholder="Search tasks"
            class="max-w-64"
          />
          <PanelToolbarGroup trailing>
            {#if view === "tasks"}
              <PanelToolbarButton
                icon={Plus}
                label="Create task"
                disabled={!model.capabilities.manageDefinitions.enabled}
                onclick={() => (addOpen = true)}
              />
            {:else}
              <PanelToolbarButton
                icon={Trash2}
                label="Prune history"
                title="Prune finished task runs"
                disabled={!model.capabilities.prune.enabled ||
                  projected.history.length === 0}
                onclick={() => (confirmPruneOpen = true)}
              />
            {/if}
          </PanelToolbarGroup>
        </PanelToolbar>
      {/if}
    {/snippet}

    {#snippet banner()}
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
