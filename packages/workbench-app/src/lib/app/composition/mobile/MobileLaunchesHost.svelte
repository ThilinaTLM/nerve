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
import type { UpdateLaunchDefinitionRequest } from "@nervekit/contracts/launch-definitions";
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
  cancelSelectedLaunch,
  cleanupLaunchRuns,
  projectLaunchPanel,
  removeLaunch,
  restartSelectedLaunch,
  runLaunchCommand,
  launchDefinitionLabel,
  launchPortConflictDescription,
  launchSelectors,
  type LaunchDefinitionEntry,
  type LaunchPanelDefinition,
  type LaunchRunEntry,
} from "$lib/features/launches";
import { createWorkbenchLaunchPanelAdapter } from "$lib/features/launches/state/workbench-launch-panel-adapter.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  launchesInProject,
  launchTitle,
} from "$lib/app/shell/mobile/mobile-activity";
import { openMobileLaunchOutput } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";
import MobileLaunchDefinitionSheet from "./MobileLaunchDefinitionSheet.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";
import {
  definitionRowDetail,
  finishedRunIds,
  definitionRowSignal,
  splitRunEntries,
  launchRunSignal,
  launchStatusLabel,
} from "./mobile-launch-rows";

/**
 * A project's saved launches and runs. Saved launches launch, edit, and delete
 * exactly as on the desktop panel; there is deliberately no free-form command
 * entry on the phone.
 */
let { route }: MobileScreenProps<"launches"> = $props();

const project = $derived(
  workspaceSelectors.projects.find(
    (candidate) => candidate.id === route.projectId,
  ),
);
const projectLaunches = $derived(
  launchesInProject(
    launchSelectors.launches,
    workspaceSelectors.projects,
    route.projectId,
  ),
);

const panel = createWorkbenchLaunchPanelAdapter(
  () => project,
  () => projectLaunches,
  () => undefined,
  {
    openLaunchOutput: (id) => openMobileLaunchOutput(id),
    cancelLaunch: (id, request) => void cancelSelectedLaunch(id, request),
    restartLaunch: (id) => void restartSelectedLaunch(id),
    removeLaunch: (id) => void removeLaunch(id),
    cleanupRuns: (ids) => void cleanupLaunchRuns(ids),
    // Saved launches launch through the `start` capability, which the adapter
    // enables only for hosts that can run commands. The phone exposes no
    // free-form command entry, so this is reachable only via saved launches.
    runCommand: (input) => void runLaunchCommand(input),
  },
);
const model = $derived(panel.model);
const launchActions = panel.actions;
const view = $derived(projectLaunchPanel(model.definitions, projectLaunches));
const runs = $derived(splitRunEntries(view.runs));
const canManage = $derived(model.capabilities.manageDefinitions.enabled);
const canStart = $derived(model.capabilities.start.enabled);
const finishedIds = $derived(finishedRunIds(view));

type LaunchForm = {
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
  submit: (request: UpdateLaunchDefinitionRequest) => Promise<void>;
};

let form = $state<LaunchForm>();
let formKey = 0;
let deleting = $state<LaunchPanelDefinition>();
let screenMenuOpen = $state(false);
let clearOpen = $state(false);

function openCreate() {
  form = {
    key: ++formKey,
    title: "New launch",
    submitLabel: "Create launch",
    submit: async (request) => {
      await launchActions.createDefinition(request);
    },
  };
}

function openEdit(definition: LaunchPanelDefinition) {
  form = {
    key: ++formKey,
    title: "Edit launch",
    submitLabel: "Save launch",
    source: definition,
    submit: async (request) => {
      await launchActions.updateDefinition(definition, request);
    },
  };
}

function openSaveRun(entry: LaunchRunEntry) {
  const { run } = entry;
  form = {
    key: ++formKey,
    title: "Save as launch",
    submitLabel: "Save launch",
    source: {
      label: run.displayName ?? run.name,
      command: run.command,
      cwd: run.cwd === project?.directory ? undefined : run.cwd,
    },
    submit: async (request) => {
      await launchActions.createDefinition({
        ...request,
        sourceLaunchId: run.id,
      });
    },
  };
}

function openDefinition(entry: LaunchDefinitionEntry) {
  if (entry.latestRun) void launchActions.openLaunchOutput(entry.latestRun.id);
  else if (canManage) openEdit(entry.definition);
}

function definitionMenu(entry: LaunchDefinitionEntry): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      label: "Run",
      icon: Play,
      disabled: !canStart || model.runningDefinitionId === entry.definition.id,
      onSelect: () => void launchActions.runDefinition(entry.definition),
    },
  ];
  if (entry.latestRun) {
    const latest = entry.latestRun;
    items.push({
      label: "Show output",
      icon: Terminal,
      onSelect: () => void launchActions.openLaunchOutput(latest.id),
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

function runMenu(entry: LaunchRunEntry): ContextMenuItem[] {
  const id = entry.run.id;
  const items: ContextMenuItem[] = [
    {
      label: "Show output",
      icon: Terminal,
      onSelect: () => void launchActions.openLaunchOutput(id),
    },
    {
      label: "Restart",
      icon: RotateCcw,
      disabled: !model.capabilities.restart.enabled,
      onSelect: () => void launchActions.restartLaunch(id),
    },
  ];
  if (canManage) {
    items.push({
      label: "Save as launch",
      icon: Save,
      onSelect: () => openSaveRun(entry),
    });
  }
  if (entry.isActive) {
    items.push({
      label: "Stop",
      icon: Square,
      destructive: true,
      onSelect: () => void launchActions.cancelLaunch(id),
    });
  } else if (entry.isRemovable) {
    items.push({
      label: "Remove",
      icon: Trash2,
      destructive: true,
      onSelect: () => void launchActions.removeLaunch(id),
    });
  }
  return items;
}

const screenMenu = $derived<ContextMenuItem[]>([
  {
    label: "Clear finished runs",
    icon: Eraser,
    disabled: !finishedIds.length || !model.capabilities.remove.enabled,
    onSelect: () => (clearOpen = true),
  },
]);
</script>

{#snippet runRows(list: LaunchRunEntry[])}
  {#each list as entry (entry.key)}
    {@const signal = launchRunSignal(entry.run.status)}
    <MobileListRow
      title={launchTitle(entry.run)}
      detail={launchStatusLabel(entry.run)}
      meta={relativeTimeLabel(entry.run.startedAt)}
      tone={signal.tone}
      pulse={signal.pulse}
      menuItems={runMenu(entry)}
      onclick={() => void launchActions.openLaunchOutput(entry.run.id)}
    />
  {/each}
{/snippet}

<MobileScreen
  title="Launches"
  subtitle={project?.name}
  onBack={backFromMobileScreen}
  backLabel="Back to project"
>
  {#snippet actions()}
    {#if canManage}
      <Button
        variant="ghost"
        size="icon"
        ariaLabel="New launch"
        onclick={openCreate}
      >
        <Plus size={18} strokeWidth={1.9} />
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      ariaLabel="Launch actions"
      onclick={() => (screenMenuOpen = true)}
    >
      <EllipsisVertical size={18} strokeWidth={1.9} />
    </Button>
  {/snippet}

  {#if view.definitions.length}
    <MobileSection title="Saved launches" meta={`${view.definitions.length}`}>
      {#each view.definitions as entry (entry.key)}
        {@const signal = definitionRowSignal(entry)}
        {@const name = launchDefinitionLabel(entry)}
        <MobileListRow
          title={name.text}
          detail={definitionRowDetail(entry, project?.directory)}
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
              ariaLabel={`Run ${name.text}`}
              disabled={!canStart ||
                model.runningDefinitionId === entry.definition.id}
              onclick={() => void launchActions.runDefinition(entry.definition)}
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
        <Empty.Title class="text-sm">No launches yet</Empty.Title>
        <Empty.Description class="text-xs">
          Save a command to run it from here or from the desktop.
        </Empty.Description>
      </Empty.Header>
      {#if canManage}
        <Empty.Content>
          <Button onclick={openCreate}>
            <Plus />
            New launch
          </Button>
        </Empty.Content>
      {/if}
    </Empty.Root>
  {/if}
</MobileScreen>

<MobileActionSheet
  open={screenMenuOpen}
  title="Launches"
  items={screenMenu}
  onOpenChange={(open) => (screenMenuOpen = open)}
/>

{#if form}
  {#key form.key}
    <MobileLaunchDefinitionSheet
      title={form.title}
      submitLabel={form.submitLabel}
      source={form.source}
      projectDir={project?.directory}
      onSubmit={form.submit}
      onClose={() => (form = undefined)}
    />
  {/key}
{/if}

<ConfirmDialog
  open={Boolean(deleting)}
  destructive
  title="Delete saved launch?"
  description={`Removes “${deleting?.label ?? deleting?.command ?? ""}” from this project's saved launches.`}
  confirmLabel="Delete"
  onConfirm={() => {
    const definition = deleting;
    deleting = undefined;
    if (!definition) return;
    // The adapter reports failures itself.
    void Promise.resolve(launchActions.deleteDefinition(definition)).catch(
      () => undefined,
    );
  }}
  onOpenChange={(open) => {
    if (!open) deleting = undefined;
  }}
/>

<ConfirmDialog
  bind:open={clearOpen}
  destructive
  title="Clear finished runs?"
  description={`Removes ${finishedIds.length === 1 ? "1 finished run" : `${finishedIds.length} finished runs`} in ${project?.name ?? "this project"} and their captured logs. Saved launches are kept.`}
  confirmLabel="Clear"
  onConfirm={() => void launchActions.cleanupRuns(finishedIds)}
/>

<ConfirmDialog
  open={Boolean(model.portConflict)}
  destructive
  title={`Port ${model.portConflict?.port ?? ""} is in use`}
  description={launchPortConflictDescription(model.portConflict)}
  confirmLabel="Stop them and run"
  onConfirm={() => void launchActions.confirmPortConflict()}
  onCancel={() => void launchActions.dismissPortConflict()}
  onOpenChange={(open) => {
    if (!open) void launchActions.dismissPortConflict();
  }}
/>
