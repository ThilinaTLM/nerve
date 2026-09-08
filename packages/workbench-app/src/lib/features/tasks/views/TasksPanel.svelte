<script lang="ts">
import ListTodo from "@lucide/svelte/icons/list-todo";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  CreateTaskDefinitionRequest,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts/task-definitions";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
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
} from "$lib/presentation/panels";
import { ItemCollection } from "$lib/presentation/items";
import TaskDefinitionDialog from "./TaskDefinitionDialog.svelte";
import TaskDefinitionRow from "./TaskDefinitionRow.svelte";
import TaskOutputPane from "./TaskOutputPane.svelte";
import TaskRunRow from "./TaskRunRow.svelte";
import TaskRunsDialog from "./TaskRunsDialog.svelte";
import {
  projectTaskPanel,
  taskPanelActiveItemKey,
} from "./task-panel-controller.js";
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
const activeItemKey = $derived(taskPanelActiveItemKey(model.selectedTask));
const selectedSiblingRuns = $derived.by(() => {
  const selected = model.selectedTask;
  if (!selected) return [];
  const entryId =
    selected.definitionId ?? selected.restartRootTaskId ?? selected.id;
  return model.tasks
    .filter(
      (task) =>
        (task.definitionId ?? task.restartRootTaskId ?? task.id) === entryId,
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
});
type TaskDialogSession =
  | { kind: "create" }
  | { kind: "edit"; definition: TaskPanelDefinition }
  | { kind: "duplicate"; definition: TaskPanelDefinition }
  | { kind: "save-run"; task: TaskRecord };

let taskDialog = $state<TaskDialogSession | undefined>();
let saving = $state(false);
let confirmPruneOpen = $state(false);
let forceKillTask = $state<TaskRecord | undefined>();
let deleteDefinition = $state<TaskPanelDefinition | undefined>();
let cleanupRunIds = $state<readonly string[]>([]);
let panelWidth = $state(0);
let runsRegion = $state<HTMLDivElement | null>(null);
let runsFooter = $state<HTMLDivElement | null>(null);
let runsDialogOpen = $state(false);
// The wide bottom dock can host the run output next to the list.
const SPLIT_MIN_WIDTH = 720;
const splitLayout = $derived(panelWidth >= SPLIT_MIN_WIDTH);
const portConflictDescription = $derived.by(() => {
  const conflict = model.portConflict;
  if (!conflict) return "";
  const processes = [
    ...new Map(
      conflict.listeners.map((listener) => [
        `${listener.pid}|${listener.identity}`,
        `${listener.processName ?? "Process"} (PID ${listener.pid})`,
      ]),
    ).values(),
  ];
  return `${processes.join(", ")} is listening on TCP port ${conflict.port}. Terminate ${processes.length === 1 ? "it" : "them"} and run this task?`;
});
const prunableRuns = $derived(
  projected.runs.filter((entry) => entry.isRemovable).length,
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

async function saveDefinition(
  input: CreateTaskDefinitionRequest | UpdateTaskDefinitionRequest,
): Promise<void> {
  const session = taskDialog;
  if (!session) return;
  saving = true;
  try {
    if (session.kind === "edit") {
      await panelActions.updateDefinition(session.definition, input);
    } else {
      await panelActions.createDefinition({
        ...input,
        ...(session.kind === "save-run"
          ? { sourceTaskId: session.task.id }
          : {}),
      });
    }
    taskDialog = undefined;
  } finally {
    saving = false;
  }
}

function dialogInitial(session: TaskDialogSession) {
  if (session.kind === "duplicate") {
    const { label, command, cwd, port, runPolicy } = session.definition;
    return { label, command, cwd, port, runPolicy };
  }
  if (session.kind === "save-run") {
    return {
      label: session.task.displayName ?? session.task.name,
      command: session.task.command,
      cwd: session.task.cwd === model.defaultCwd ? undefined : session.task.cwd,
    };
  }
  return undefined;
}

async function cleanupRuns(): Promise<void> {
  const ids = cleanupRunIds;
  cleanupRunIds = [];
  await panelActions.cleanupRuns(ids);
}

async function removeDefinition(): Promise<void> {
  if (!deleteDefinition) return;
  await panelActions.deleteDefinition(deleteDefinition);
  deleteDefinition = undefined;
}

async function confirmForceKill(): Promise<void> {
  if (!forceKillTask) return;
  const taskId = forceKillTask.id;
  forceKillTask = undefined;
  await panelActions.forceKillTask(taskId);
}

function requestForceKill(taskId: string): void {
  const task = model.tasks.find((run) => run.id === taskId);
  if (!task) return;
  if (task.status === "recovered") {
    // The user never asked to terminate a recovered run, so confirm first.
    forceKillTask = task;
  } else {
    // Stuck-stopping runs were already stopped once; kill immediately.
    void panelActions.forceKillTask(taskId);
  }
}

function rerunDefinition(entry: { definition?: TaskPanelDefinition }): void {
  if (entry.definition) void panelActions.runDefinition(entry.definition);
}
</script>

{#snippet taskList()}
  <ItemCollection
    activeKey={activeItemKey}
    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
  >
    <div
      class="flex min-w-0 flex-col overflow-y-auto"
      class:flex-1={!model.definitionsLoading &&
        projected.definitions.length === 0 &&
        projected.runs.length === 0}
      class:shrink={model.definitionsLoading ||
        projected.definitions.length > 0 ||
        projected.runs.length > 0}
    >
      {#if model.definitionsLoading && model.definitions.length === 0}
        <p class="py-1 text-xs text-muted-foreground">Loading tasks…</p>
      {:else if projected.definitions.length === 0}
        <PanelEmpty
          icon={ListTodo}
          title="No saved tasks"
          description="Create a task to run it anytime."
        >
          {#snippet action()}
            <Button
              size="xs"
              variant="outline"
              disabled={!model.capabilities.manageDefinitions.enabled}
              onclick={() => (taskDialog = { kind: "create" })}
            >
              <Plus />
              New task
            </Button>
          {/snippet}
        </PanelEmpty>
      {:else}
        <PanelList role="none" class="gap-1">
          {#each projected.definitions as entry (entry.key)}
            <TaskDefinitionRow
              {entry}
              {capabilities}
              active={activeItemKey === entry.key}
              onOpen={(id) => void panelActions.openTaskOutput(id)}
              onRun={() => void panelActions.runDefinition(entry.definition)}
              onCancel={(id) => void panelActions.cancelTask(id)}
              onForceKill={requestForceKill}
              onRestart={(id) => void panelActions.restartTask(id)}
              onEdit={() =>
                (taskDialog = {
                  kind: "edit",
                  definition: entry.definition,
                })}
              onDuplicate={() =>
                (taskDialog = {
                  kind: "duplicate",
                  definition: entry.definition,
                })}
              onDelete={() => (deleteDefinition = entry.definition)}
              onCleanupRuns={(ids) => (cleanupRunIds = ids)}
              onCopy={(text) => void panelActions.copyText(text)}
            />
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
        <PanelList ariaLabel="Runs" class="shrink-0 gap-1">
          {#each visibleRuns as entry (entry.key)}
            <TaskRunRow
              {entry}
              {capabilities}
              active={activeItemKey === entry.key}
              onOpen={(id) => void panelActions.openTaskOutput(id)}
              onCancel={(id) => void panelActions.cancelTask(id)}
              onForceKill={requestForceKill}
              onRestart={(id) => void panelActions.restartTask(id)}
              onRemove={(id) => void panelActions.removeTask(id)}
              onCopy={(text) => void panelActions.copyText(text)}
              onSaveAsDefinition={(task) =>
                (taskDialog = { kind: "save-run", task })}
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
  </ItemCollection>
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
              onclick={() => (taskDialog = { kind: "create" })}
            />
          {/if}
        {/snippet}
      </PanelHeader>
      {#if !model.availability.available}
        <PanelBanner tone="neutral">{model.availability.message}</PanelBanner>
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
              siblingRuns={selectedSiblingRuns}
              canRestart={capabilities.restart}
              canCancel={capabilities.cancel}
              onSelectRun={(taskId) => void panelActions.selectTask(taskId)}
              onRestartRun={(taskId) => void panelActions.restartTask(taskId)}
              onCancelRun={(taskId) => void panelActions.cancelTask(taskId)}
              onForceKillRun={(taskId) =>
                void panelActions.forceKillTask(taskId)}
              onCleanupRuns={(taskIds) => panelActions.cleanupRuns(taskIds)}
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
  onOpen={(id) => void panelActions.openTaskOutput(id)}
  onCancel={(id) => void panelActions.cancelTask(id)}
  onForceKill={requestForceKill}
  onRestart={(id) => void panelActions.restartTask(id)}
  onRerunDefinition={rerunDefinition}
  onRemove={(id) => void panelActions.removeTask(id)}
  onCopy={(text) => void panelActions.copyText(text)}
  onSaveAsDefinition={(task) => (taskDialog = { kind: "save-run", task })}
/>
{#if taskDialog}
  {@const session = taskDialog}
  {#key session}
    <TaskDefinitionDialog
      open
      definition={session.kind === "edit" ? session.definition : undefined}
      initial={dialogInitial(session)}
      projectCwd={model.defaultCwd}
      title={session.kind === "duplicate"
        ? "Duplicate task"
        : session.kind === "save-run"
          ? "Save as task definition"
          : undefined}
      description={session.kind === "duplicate"
        ? "Create a new task definition from this saved task."
        : session.kind === "save-run"
          ? "Create a reusable definition from this run. The run stays linked to it."
          : undefined}
      submitLabel={session.kind === "duplicate"
        ? "Create duplicate"
        : session.kind === "save-run"
          ? "Save task"
          : undefined}
      {saving}
      onSave={(input) => void saveDefinition(input)}
      onOpenChange={(open) => {
        if (!open) taskDialog = undefined;
      }}
    />
  {/key}
{/if}
<ConfirmDialog
  open={Boolean(model.portConflict)}
  destructive
  title="Port already in use"
  description={portConflictDescription}
  confirmLabel="Terminate and run"
  onConfirm={() => void panelActions.confirmPortConflict()}
  onCancel={() => void panelActions.dismissPortConflict()}
  onOpenChange={(open) => {
    if (!open) void panelActions.dismissPortConflict();
  }}
/>
<ConfirmDialog
  open={Boolean(forceKillTask)}
  destructive
  title="Force kill task?"
  description={`Immediately terminates ${forceKillTask?.displayName ?? forceKillTask?.name ?? forceKillTask?.command ?? "this task"}. Buffered output and process cleanup may be lost.`}
  confirmLabel="Force kill"
  onConfirm={() => void confirmForceKill()}
  onCancel={() => (forceKillTask = undefined)}
  onOpenChange={(open) => {
    if (!open) forceKillTask = undefined;
  }}
/>
<ConfirmDialog
  open={cleanupRunIds.length > 0}
  destructive
  title="Clean up old task runs?"
  description={`This removes ${cleanupRunIds.length} old finished ${cleanupRunIds.length === 1 ? "run" : "runs"} and their captured logs. The latest run is retained.`}
  confirmLabel="Clean up"
  onConfirm={() => void cleanupRuns()}
  onCancel={() => (cleanupRunIds = [])}
  onOpenChange={(open) => {
    if (!open) cleanupRunIds = [];
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
