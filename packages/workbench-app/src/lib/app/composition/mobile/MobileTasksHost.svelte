<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import Eraser from "@lucide/svelte/icons/eraser";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import Plus from "@lucide/svelte/icons/plus";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Save from "@lucide/svelte/icons/save";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { UpdateTaskDefinitionRequest } from "@nervekit/contracts/task-definitions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileActionSheet,
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  cancelSelectedTask,
  cleanupTaskRuns,
  projectTaskPanel,
  pruneFinishedTasks,
  removeTask,
  restartSelectedTask,
  runTaskCommand,
  taskDefinitionLabel,
  taskPortConflictDescription,
  taskSelectors,
  type TaskDefinitionEntry,
  type TaskPanelDefinition,
  type TaskRunEntry,
} from "$lib/features/tasks";
import { createWorkbenchTaskPanelAdapter } from "$lib/features/tasks/state/workbench-task-panel-adapter.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { taskProject, taskTitle } from "$lib/app/shell/mobile/mobile-activity";
import { openMobileTaskOutput } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";
import MobileTaskDefinitionSheet from "./MobileTaskDefinitionSheet.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";
import {
  definitionRowDetail,
  definitionRowSignal,
  splitRunEntries,
  taskRunSignal,
  taskStatusLabel,
} from "./mobile-task-rows";

/**
 * A project's saved tasks and runs. Saved tasks launch, edit, and delete
 * exactly as on the desktop panel; there is deliberately no free-form command
 * entry on the phone.
 */
let { route }: MobileScreenProps<"tasks"> = $props();

const project = $derived(
  workspaceSelectors.projects.find(
    (candidate) => candidate.id === route.projectId,
  ),
);
const projectTasks = $derived(
  project
    ? taskSelectors.tasks.filter(
        (task) => taskProject(task, [project])?.id === project.id,
      )
    : [],
);

const panel = createWorkbenchTaskPanelAdapter(
  () => project,
  () => projectTasks,
  () => undefined,
  {
    openTaskOutput: (id) => openMobileTaskOutput(id),
    cancelTask: (id, request) => void cancelSelectedTask(id, request),
    restartTask: (id) => void restartSelectedTask(id),
    removeTask: (id) => void removeTask(id),
    cleanupRuns: (ids) => void cleanupTaskRuns(ids),
    pruneTasks: () => void pruneFinishedTasks(),
    // Saved tasks launch through the `start` capability, which the adapter
    // enables only for hosts that can run commands. The phone exposes no
    // free-form command entry, so this is reachable only via saved tasks.
    runCommand: (input) => void runTaskCommand(input),
  },
);
const model = $derived(panel.model);
const taskActions = panel.actions;
const view = $derived(projectTaskPanel(model.definitions, projectTasks));
const runs = $derived(splitRunEntries(view.runs));
const canManage = $derived(model.capabilities.manageDefinitions.enabled);
const canStart = $derived(model.capabilities.start.enabled);
const hasFinished = $derived(
  view.runs.some((entry) => entry.isRemovable) ||
    view.definitions.some((entry) => entry.runs.some((run) => run.isRemovable)),
);

type TaskForm = {
  key: number;
  title: string;
  submitLabel: string;
  source?: {
    label?: string;
    command: string;
    cwd?: string;
    port?: number;
    runPolicy?: "single" | "concurrent";
  };
  submit: (request: UpdateTaskDefinitionRequest) => Promise<void>;
};

let form = $state<TaskForm>();
let formKey = 0;
let deleting = $state<TaskPanelDefinition>();
let screenMenuOpen = $state(false);

function openCreate() {
  form = {
    key: ++formKey,
    title: "New task",
    submitLabel: "Create task",
    submit: async (request) => {
      await taskActions.createDefinition(request);
    },
  };
}

function openEdit(definition: TaskPanelDefinition) {
  form = {
    key: ++formKey,
    title: "Edit task",
    submitLabel: "Save task",
    source: definition,
    submit: async (request) => {
      await taskActions.updateDefinition(definition, request);
    },
  };
}

function openSaveRun(entry: TaskRunEntry) {
  const { run } = entry;
  form = {
    key: ++formKey,
    title: "Save as task",
    submitLabel: "Save task",
    source: {
      label: run.displayName ?? run.name,
      command: run.command,
      cwd: run.cwd === project?.dir ? undefined : run.cwd,
    },
    submit: async (request) => {
      await taskActions.createDefinition({ ...request, sourceTaskId: run.id });
    },
  };
}

function openDefinition(entry: TaskDefinitionEntry) {
  if (entry.latestRun) void taskActions.openTaskOutput(entry.latestRun.id);
  else if (canManage) openEdit(entry.definition);
}

function definitionMenu(entry: TaskDefinitionEntry): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      label: "Run",
      icon: Play,
      disabled: !canStart || model.runningDefinitionId === entry.definition.id,
      onSelect: () => void taskActions.runDefinition(entry.definition),
    },
  ];
  if (entry.latestRun) {
    const latest = entry.latestRun;
    items.push({
      label: "Show output",
      icon: Terminal,
      onSelect: () => void taskActions.openTaskOutput(latest.id),
    });
  }
  if (canManage) {
    items.push(
      {
        label: "Edit",
        icon: Pencil,
        onSelect: () => openEdit(entry.definition),
      },
      { type: "separator" },
      {
        label: "Delete",
        icon: Trash2,
        destructive: true,
        onSelect: () => (deleting = entry.definition),
      },
    );
  }
  return items;
}

function runMenu(entry: TaskRunEntry): ContextMenuItem[] {
  const id = entry.run.id;
  const items: ContextMenuItem[] = [
    {
      label: "Show output",
      icon: Terminal,
      onSelect: () => void taskActions.openTaskOutput(id),
    },
    {
      label: "Restart",
      icon: RotateCcw,
      disabled: !model.capabilities.restart.enabled,
      onSelect: () => void taskActions.restartTask(id),
    },
  ];
  if (canManage) {
    items.push({
      label: "Save as task",
      icon: Save,
      onSelect: () => openSaveRun(entry),
    });
  }
  if (entry.isActive) {
    items.push({
      label: "Stop",
      icon: Square,
      destructive: true,
      onSelect: () => void taskActions.cancelTask(id),
    });
  } else if (entry.isRemovable) {
    items.push({
      label: "Remove",
      icon: Trash2,
      destructive: true,
      onSelect: () => void taskActions.removeTask(id),
    });
  }
  return items;
}

const screenMenu = $derived<ContextMenuItem[]>([
  {
    label: "Clear finished runs",
    icon: Eraser,
    disabled: !hasFinished,
    onSelect: () => void taskActions.pruneTasks(),
  },
]);
</script>

{#snippet runRows(list: TaskRunEntry[])}
  {#each list as entry (entry.key)}
    {@const signal = taskRunSignal(entry.run.status)}
    <MobileListRow
      title={taskTitle(entry.run)}
      detail={taskStatusLabel(entry.run)}
      meta={relativeTimeLabel(entry.run.startedAt)}
      tone={signal.tone}
      pulse={signal.pulse}
      menuItems={runMenu(entry)}
      onclick={() => void taskActions.openTaskOutput(entry.run.id)}
    />
  {/each}
{/snippet}

<MobileScreen
  title="Tasks"
  subtitle={project?.name}
  onBack={backFromMobileScreen}
  backLabel="Back to project"
>
  {#snippet actions()}
    {#if canManage}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="New task"
        onclick={openCreate}
      >
        <Plus size={18} strokeWidth={1.9} />
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Task actions"
      onclick={() => (screenMenuOpen = true)}
    >
      <EllipsisVertical size={18} strokeWidth={1.9} />
    </Button>
  {/snippet}

  {#if view.definitions.length}
    <MobileSection title="Saved tasks" meta={`${view.definitions.length}`}>
      {#each view.definitions as entry (entry.key)}
        {@const signal = definitionRowSignal(entry)}
        {@const name = taskDefinitionLabel(entry)}
        <MobileListRow
          title={name.text}
          detail={definitionRowDetail(entry, project?.dir)}
          meta={entry.latestRun
            ? relativeTimeLabel(entry.latestRun.startedAt)
            : undefined}
          icon={signal ? undefined : Terminal}
          tone={signal?.tone}
          pulse={signal?.pulse}
          menuItems={definitionMenu(entry)}
          onclick={() => openDefinition(entry)}
        >
          {#snippet trailing()}
            <Button
              variant="outline"
              size="sm"
              ariaLabel={`Run ${name.text}`}
              disabled={!canStart ||
                model.runningDefinitionId === entry.definition.id}
              onclick={() => void taskActions.runDefinition(entry.definition)}
            >
              <Play />
              Run
            </Button>
          {/snippet}
        </MobileListRow>
      {/each}
    </MobileSection>
  {/if}
  {#if runs.running.length}
    <MobileSection title="Running" meta={`${runs.running.length}`}>
      {@render runRows(runs.running)}
    </MobileSection>
  {/if}
  {#if runs.recent.length}
    <MobileSection title="Recent runs" meta={`${runs.recent.length}`}>
      {@render runRows(runs.recent)}
    </MobileSection>
  {/if}
  {#if !view.definitions.length && !view.runs.length && !model.definitionsLoading}
    <Empty.Root class="px-6 py-10">
      <Empty.Header>
        <Empty.Media class="text-muted-foreground">
          <Terminal size={28} strokeWidth={1.6} />
        </Empty.Media>
        <Empty.Title class="text-sm">No tasks yet</Empty.Title>
        <Empty.Description class="text-xs">
          Save a command to run it from here or from the desktop.
        </Empty.Description>
      </Empty.Header>
      {#if canManage}
        <Empty.Content>
          <Button onclick={openCreate}>
            <Plus />
            New task
          </Button>
        </Empty.Content>
      {/if}
    </Empty.Root>
  {/if}
</MobileScreen>

<MobileActionSheet
  open={screenMenuOpen}
  title="Tasks"
  items={screenMenu}
  onOpenChange={(open) => (screenMenuOpen = open)}
/>

{#if form}
  {#key form.key}
    <MobileTaskDefinitionSheet
      title={form.title}
      submitLabel={form.submitLabel}
      source={form.source}
      projectDir={project?.dir}
      onSubmit={form.submit}
      onClose={() => (form = undefined)}
    />
  {/key}
{/if}

<ConfirmDialog
  open={Boolean(deleting)}
  destructive
  title="Delete saved task?"
  description={`Removes “${deleting?.label ?? deleting?.command ?? ""}” from this project's saved tasks.`}
  confirmLabel="Delete"
  onConfirm={() => {
    const definition = deleting;
    deleting = undefined;
    if (!definition) return;
    // The adapter reports failures itself.
    void Promise.resolve(taskActions.deleteDefinition(definition)).catch(
      () => undefined,
    );
  }}
  onOpenChange={(open) => {
    if (!open) deleting = undefined;
  }}
/>

<ConfirmDialog
  open={Boolean(model.portConflict)}
  destructive
  title={`Port ${model.portConflict?.port ?? ""} is in use`}
  description={taskPortConflictDescription(model.portConflict)}
  confirmLabel="Stop them and run"
  onConfirm={() => void taskActions.confirmPortConflict()}
  onCancel={() => void taskActions.dismissPortConflict()}
  onOpenChange={(open) => {
    if (!open) void taskActions.dismissPortConflict();
  }}
/>
