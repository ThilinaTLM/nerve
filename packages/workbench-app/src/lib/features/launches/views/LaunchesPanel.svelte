<script lang="ts">
import ListTodo from "@lucide/svelte/icons/list-todo";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  CreateLaunchDefinitionRequest,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
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
import LaunchDefinitionDialog from "./LaunchDefinitionDialog.svelte";
import LaunchDefinitionRow from "./LaunchDefinitionRow.svelte";
import LaunchOutputPane from "./LaunchOutputPane.svelte";
import LaunchRunRow from "./LaunchRunRow.svelte";
import LaunchRunsDialog from "./LaunchRunsDialog.svelte";
import {
  projectLaunchPanel,
  launchPanelActiveItemKey,
  launchPortConflictDescription,
} from "./launch-panel-controller.js";
import type {
  LaunchEntryCapabilities,
  LaunchPanelActions,
  LaunchPanelDefinition,
  LaunchPanelModel,
} from "./launch-panel-types.js";

let {
  model,
  actions: panelActions,
}: {
  model: LaunchPanelModel;
  actions: LaunchPanelActions;
} = $props();

const projected = $derived(
  projectLaunchPanel(model.definitions, model.launches),
);
const activeItemKey = $derived(launchPanelActiveItemKey(model.selectedLaunch));
const selectedSiblingRuns = $derived.by(() => {
  const selected = model.selectedLaunch;
  if (!selected) return [];
  const entryId =
    selected.definitionId ?? selected.restartRootLaunchId ?? selected.id;
  return model.launches
    .filter(
      (launch) =>
        (launch.definitionId ?? launch.restartRootLaunchId ?? launch.id) ===
        entryId,
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
});
type LaunchDialogSession =
  | { kind: "create" }
  | { kind: "edit"; definition: LaunchPanelDefinition }
  | { kind: "duplicate"; definition: LaunchPanelDefinition }
  | { kind: "save-run"; launch: LaunchRecord };

let launchDialog = $state<LaunchDialogSession | undefined>();
let saving = $state(false);
let confirmPruneOpen = $state(false);
let forceKillLaunch = $state<LaunchRecord | undefined>();
let deleteDefinition = $state<LaunchPanelDefinition | undefined>();
let cleanupRunIds = $state<readonly string[]>([]);
let panelWidth = $state(0);
let runsRegion = $state<HTMLDivElement | null>(null);
let runsFooter = $state<HTMLDivElement | null>(null);
let runsDialogOpen = $state(false);
// The wide bottom dock can host the run output next to the list.
const SPLIT_MIN_WIDTH = 720;
const splitLayout = $derived(panelWidth >= SPLIT_MIN_WIDTH);
const portConflictDescription = $derived(
  launchPortConflictDescription(model.portConflict),
);
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
const capabilities = $derived<LaunchEntryCapabilities>({
  start: model.capabilities.start.enabled,
  cancel: model.capabilities.cancel.enabled,
  restart: model.capabilities.restart.enabled,
  remove: model.capabilities.remove.enabled,
  logs: model.capabilities.logs.enabled,
  copy: model.capabilities.copy.enabled,
  manageDefinitions: model.capabilities.manageDefinitions.enabled,
});

async function saveDefinition(
  input: CreateLaunchDefinitionRequest | UpdateLaunchDefinitionRequest,
): Promise<void> {
  const session = launchDialog;
  if (!session) return;
  saving = true;
  try {
    if (session.kind === "edit") {
      await panelActions.updateDefinition(session.definition, input);
    } else {
      await panelActions.createDefinition({
        ...input,
        ...(session.kind === "save-run"
          ? { sourceLaunchId: session.launch.id }
          : {}),
      });
    }
    launchDialog = undefined;
  } finally {
    saving = false;
  }
}

function dialogInitial(session: LaunchDialogSession) {
  if (session.kind === "duplicate") {
    const { label, command, cwd, port, runPolicy } = session.definition;
    return { label, command, cwd, port, runPolicy };
  }
  if (session.kind === "save-run") {
    return {
      label: session.launch.displayName ?? session.launch.name,
      command: session.launch.command,
      cwd:
        session.launch.cwd === model.defaultCwd
          ? undefined
          : session.launch.cwd,
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
  if (!forceKillLaunch) return;
  const launchId = forceKillLaunch.id;
  forceKillLaunch = undefined;
  await panelActions.forceKillLaunch(launchId);
}

function requestForceKill(launchId: string): void {
  const launch = model.launches.find((run) => run.id === launchId);
  if (!launch) return;
  else {
    // Stuck-stopping runs were already stopped once; kill immediately.
    void panelActions.forceKillLaunch(launchId);
  }
}

function rerunDefinition(entry: { definition?: LaunchPanelDefinition }): void {
  if (entry.definition) void panelActions.runDefinition(entry.definition);
}
</script>

{#snippet launchList()}
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
        <p class="py-1 text-xs text-muted-foreground">Loading launches…</p>
      {:else if projected.definitions.length === 0}
        <PanelEmpty
          icon={ListTodo}
          title="No launch configurations yet"
          description="Create a launch configuration to run it anytime."
        >
          {#snippet action()}
            <Button
              size="xs"
              variant="outline"
              disabled={!model.capabilities.manageDefinitions.enabled}
              onclick={() => (launchDialog = { kind: "create" })}
            >
              <Plus />
              New launch
            </Button>
          {/snippet}
        </PanelEmpty>
      {:else}
        <PanelList role="none" class="gap-1">
          {#each projected.definitions as entry (entry.key)}
            <LaunchDefinitionRow
              {entry}
              {capabilities}
              active={activeItemKey === entry.key}
              onOpen={(id) => void panelActions.openLaunchOutput(id)}
              onRun={() => void panelActions.runDefinition(entry.definition)}
              onCancel={(id) => void panelActions.cancelLaunch(id)}
              onForceKill={requestForceKill}
              onRestart={(id) => void panelActions.restartLaunch(id)}
              onEdit={() =>
                (launchDialog = {
                  kind: "edit",
                  definition: entry.definition,
                })}
              onDuplicate={() =>
                (launchDialog = {
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
              title="Prune finished ad-hoc launch runs"
              disabled={!model.capabilities.prune.enabled || prunableRuns === 0}
              onclick={() => (confirmPruneOpen = true)}
            />
          {/snippet}
        </PanelSectionHeader>
        <PanelList ariaLabel="Runs" class="shrink-0 gap-1">
          {#each visibleRuns as entry (entry.key)}
            <LaunchRunRow
              {entry}
              {capabilities}
              active={activeItemKey === entry.key}
              onOpen={(id) => void panelActions.openLaunchOutput(id)}
              onCancel={(id) => void panelActions.cancelLaunch(id)}
              onForceKill={requestForceKill}
              onRestart={(id) => void panelActions.restartLaunch(id)}
              onRemove={(id) => void panelActions.removeLaunch(id)}
              onCopy={(text) => void panelActions.copyText(text)}
              onSaveAsDefinition={(launch) =>
                (launchDialog = { kind: "save-run", launch })}
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
        title="Launches"
        count={model.availability.available
          ? projected.definitions.length
          : undefined}
      >
        {#snippet trailing()}
          {#if model.availability.available}
            <PanelToolbarButton
              icon={Plus}
              label="Create launch"
              disabled={!model.capabilities.manageDefinitions.enabled}
              onclick={() => (launchDialog = { kind: "create" })}
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
              {@render launchList()}
            </div>
          </Pane>
          <PaneResizer aria-label="Resize launch output" />
          <Pane defaultSize={62} minSize={30}>
            <LaunchOutputPane
              launch={model.selectedLaunch}
              launchLogs={model.selectedLogs}
              siblingRuns={selectedSiblingRuns}
              canRestart={capabilities.restart}
              canCancel={capabilities.cancel}
              onSelectRun={(launchId) =>
                void panelActions.selectLaunch(launchId)}
              onRestartRun={(launchId) =>
                void panelActions.restartLaunch(launchId)}
              onCancelRun={(launchId) =>
                void panelActions.cancelLaunch(launchId)}
              onForceKillRun={(launchId) =>
                void panelActions.forceKillLaunch(launchId)}
              onCleanupRuns={(launchIds) => panelActions.cleanupRuns(launchIds)}
            />
          </Pane>
        </PaneGroup>
      {:else}
        {@render launchList()}
      {/if}
    {/if}
  </PanelView>
</div>

<LaunchRunsDialog
  bind:open={runsDialogOpen}
  runs={projected.runs}
  {capabilities}
  onOpen={(id) => void panelActions.openLaunchOutput(id)}
  onCancel={(id) => void panelActions.cancelLaunch(id)}
  onForceKill={requestForceKill}
  onRestart={(id) => void panelActions.restartLaunch(id)}
  onRerunDefinition={rerunDefinition}
  onRemove={(id) => void panelActions.removeLaunch(id)}
  onCopy={(text) => void panelActions.copyText(text)}
  onSaveAsDefinition={(launch) => (launchDialog = { kind: "save-run", launch })}
/>
{#if launchDialog}
  {@const session = launchDialog}
  {#key session}
    <LaunchDefinitionDialog
      open
      definition={session.kind === "edit" ? session.definition : undefined}
      initial={dialogInitial(session)}
      projectCwd={model.defaultCwd}
      title={session.kind === "duplicate"
        ? "Duplicate launch"
        : session.kind === "save-run"
          ? "Save as launch configuration"
          : undefined}
      description={session.kind === "duplicate"
        ? "Create a new launch configuration from this saved launch."
        : session.kind === "save-run"
          ? "Create a reusable definition from this run. The run stays linked to it."
          : undefined}
      submitLabel={session.kind === "duplicate"
        ? "Create duplicate"
        : session.kind === "save-run"
          ? "Save launch"
          : undefined}
      {saving}
      onSave={(input) => void saveDefinition(input)}
      onOpenChange={(open) => {
        if (!open) launchDialog = undefined;
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
  open={Boolean(forceKillLaunch)}
  destructive
  title="Force kill launch?"
  description={`Immediately terminates ${forceKillLaunch?.displayName ?? forceKillLaunch?.name ?? forceKillLaunch?.command ?? "this launch"}. Buffered output and process cleanup may be lost.`}
  confirmLabel="Force kill"
  onConfirm={() => void confirmForceKill()}
  onCancel={() => (forceKillLaunch = undefined)}
  onOpenChange={(open) => {
    if (!open) forceKillLaunch = undefined;
  }}
/>
<ConfirmDialog
  open={cleanupRunIds.length > 0}
  destructive
  title="Clean up old launch runs?"
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
  title="Delete saved launch?"
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
  title="Prune launch history"
  description="This removes completed ad-hoc launch runs and their captured logs. Saved launches are retained."
  confirmLabel="Prune"
  onConfirm={() => void panelActions.pruneLaunches()}
/>
