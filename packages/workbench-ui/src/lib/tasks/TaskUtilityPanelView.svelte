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
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import TaskDefinitionDialog from "./TaskDefinitionDialog.svelte";
import TaskEntryItem from "./TaskEntryItem.svelte";
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

<div class="flex h-full min-h-0 flex-col gap-2 p-2">
  {#if !model.availability.available}
    <p class="px-1 text-xs text-muted-foreground">
      {model.availability.message}
    </p>
  {:else}
    {#if model.notice}<p
        class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground"
      >
        {model.notice}
      </p>{/if}
    <div class="flex items-center gap-1 rounded-md bg-muted p-1">
      <Button
        size="xs"
        variant={view === "tasks" ? "secondary" : "ghost"}
        class="flex-1 gap-1"
        onclick={() => (view = "tasks")}
        ><ListTodo class="size-3" />Tasks
        <span class="font-mono">{projected.tasks.length}</span></Button
      >
      <Button
        size="xs"
        variant={view === "history" ? "secondary" : "ghost"}
        class="flex-1 gap-1"
        onclick={() => (view = "history")}
        ><History class="size-3" />History
        <span class="font-mono">{projected.history.length}</span></Button
      >
      {#if view === "tasks"}<Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Create task"
          title="Create task"
          disabled={!model.capabilities.manageDefinitions.enabled}
          onclick={() => (addOpen = true)}><Plus class="size-3.5" /></Button
        >{:else}<Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Prune history"
          title="Prune finished task runs"
          disabled={!model.capabilities.prune.enabled ||
            projected.history.length === 0}
          class="text-muted-foreground hover:text-destructive"
          onclick={() => (confirmPruneOpen = true)}
          ><Trash2 class="size-3.5" /></Button
        >{/if}
    </div>
    <Input
      size="xs"
      bind:value={query}
      placeholder="Search tasks"
      aria-label="Search tasks"
    />
    <div class="flex min-h-0 flex-col gap-1 overflow-y-auto">
      {#if model.definitionsLoading && model.definitions.length === 0}
        <p class="px-1 py-2 text-xs text-muted-foreground">Loading tasks…</p>
      {:else if entries.length === 0}
        <div
          class="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground"
        >
          {view === "tasks"
            ? "No saved or active tasks. Create one to run it anytime."
            : "No completed ad-hoc tasks."}
        </div>
      {:else}
        {#each entries as entry (entry.key)}
          <TaskEntryItem
            {entry}
            {capabilities}
            selected={entry.runs.some(
              (run) => run.id === model.selectedTask?.id,
            )}
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
    </div>
  {/if}
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
