<script lang="ts">
import History from "@lucide/svelte/icons/history";
import ListTodo from "@lucide/svelte/icons/list-todo";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  CreatePinnedCommandRequest,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import PinnedCommandDialog from "./PinnedCommandDialog.svelte";
import TaskEntryItem from "./TaskEntryItem.svelte";
import { projectTaskPanelEntries } from "./task-panel-controller.js";
import type {
  NormalizedPinnedCommand,
  TaskPanelActions,
  TaskPanelModel,
  TaskPanelSectionState,
} from "./task-panel-types.js";

let {
  model,
  actions: panelActions,
}: {
  model: TaskPanelModel;
  actions: TaskPanelActions;
  sectionState?: TaskPanelSectionState;
  onSectionOpenChange?: (
    section: keyof TaskPanelSectionState,
    open: boolean,
  ) => void;
} = $props();

const projected = $derived(
  projectTaskPanelEntries(model.pinnedCommands, model.tasks),
);
let view = $state<"tasks" | "history">("tasks");
let addOpen = $state(false);
let saving = $state(false);
let confirmPruneOpen = $state(false);
let editDefinition = $state<NormalizedPinnedCommand | undefined>();
let deleteDefinition = $state<NormalizedPinnedCommand | undefined>();
let query = $state("");
const entries = $derived(
  (view === "tasks" ? projected.tasks : projected.history).filter((entry) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [
      entry.definition?.label,
      entry.definition?.command ?? entry.latestRun?.command,
      entry.definition?.cwd ?? entry.latestRun?.cwd,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(needle));
  }),
);

async function createDefinition(
  input: CreatePinnedCommandRequest,
): Promise<void> {
  saving = true;
  try {
    await panelActions.createPinned(input);
    addOpen = false;
  } finally {
    saving = false;
  }
}

async function updateDefinition(
  input: UpdatePinnedCommandRequest,
): Promise<void> {
  if (!editDefinition) return;
  saving = true;
  try {
    await panelActions.updatePinned(editDefinition, input);
    editDefinition = undefined;
  } finally {
    saving = false;
  }
}

async function removeDefinition(): Promise<void> {
  if (!deleteDefinition) return;
  await panelActions.deletePinned(deleteDefinition);
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
          disabled={!model.capabilities.managePinned.enabled}
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
      bind:value={query}
      placeholder="Search tasks"
      aria-label="Search tasks"
    />
    <div class="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
      {#if model.pinnedLoading && model.pinnedCommands.length === 0}
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
            selected={entry.runs.some(
              (run) => run.id === model.selectedTask?.id,
            )}
            onOpen={(id) => void panelActions.openTaskOutput(id)}
            onRun={() =>
              entry.definition && void panelActions.runPinned(entry.definition)}
            onCancel={(id) => void panelActions.cancelTask(id)}
            onRestart={(id) => void panelActions.restartTask(id)}
            onEdit={() => (editDefinition = entry.definition)}
            onDelete={() => (deleteDefinition = entry.definition)}
          />
          {#if entry.needsRecovery}<p class="-mt-1 px-2 text-xs text-warning">
              {entry.latestRun?.status === "recovered"
                ? "Process recovered; live output disconnected."
                : "Process identity needs recovery review."}
            </p>{/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>

<PinnedCommandDialog
  bind:open={addOpen}
  projectCwd={model.defaultCwd}
  {saving}
  onSave={(input) => void createDefinition(input)}
/>
<PinnedCommandDialog
  open={Boolean(editDefinition)}
  command={editDefinition}
  projectCwd={model.defaultCwd}
  {saving}
  onSave={(input) => void updateDefinition(input)}
  onOpenChange={(open) => {
    if (!open) editDefinition = undefined;
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
