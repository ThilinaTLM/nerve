<script lang="ts">
import { untrack, type Snippet } from "svelte";
import ListTodo from "@lucide/svelte/icons/list-todo";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  LaunchFolder,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
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
import LaunchDefinitionTree from "./LaunchDefinitionTree.svelte";
import LaunchFolderDialog from "./LaunchFolderDialog.svelte";
import LaunchOutputPane from "./LaunchOutputPane.svelte";
import LaunchRunRow from "./LaunchRunRow.svelte";
import LaunchRunsDialog from "./LaunchRunsDialog.svelte";
import {
  projectLaunchPanel,
  launchPanelActiveItemKey,
  launchPortConflictDescription,
} from "./launch-panel-controller.js";
import {
  buildLaunchTree,
  launchFolderOptions,
  siblingsOf,
} from "./launch-tree.js";
import type {
  LaunchEntryCapabilities,
  LaunchPanelActions,
  LaunchPanelDefinition,
  LaunchPanelModel,
} from "./launch-panel-types.js";

let {
  model,
  actions: panelActions,
  configurationNotice,
}: {
  model: LaunchPanelModel;
  actions: LaunchPanelActions;
  /** Host-provided notice about unusable launch configuration files. */
  configurationNotice?: Snippet;
} = $props();

let refreshingDefinitions = $state(false);

async function refreshDefinitions() {
  if (refreshingDefinitions) return;
  refreshingDefinitions = true;
  try {
    await panelActions.refreshDefinitions();
  } finally {
    refreshingDefinitions = false;
  }
}

// Without a valid catalog snapshot, a missing definition proves nothing, so
// linked runs must stay attached instead of looking deleted.
const catalogAuthoritative = $derived(
  model.catalogError === undefined && model.catalogRevision !== undefined,
);
const projected = $derived(
  projectLaunchPanel(model.definitions, model.launches, catalogAuthoritative),
);
const tree = $derived(buildLaunchTree(model.folders, projected.definitions));
const folderOptions = $derived(launchFolderOptions(tree));
// Structural edits wait for a valid catalog revision; an unreadable catalog
// must not look like an empty one we could overwrite.
const canEditCatalog = $derived(
  model.capabilities.manageDefinitions.enabled && catalogAuthoritative,
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
  | { kind: "create"; parentFolderId?: string | null }
  | { kind: "edit"; definition: LaunchPanelDefinition }
  | { kind: "duplicate"; definition: LaunchPanelDefinition }
  | { kind: "save-run"; launch: LaunchRecord };

let launchDialog = $state<LaunchDialogSession | undefined>();
type FolderDialogSession =
  | { kind: "create"; parentFolderId: string | null }
  | { kind: "rename"; folder: LaunchFolder };

let folderDialog = $state<FolderDialogSession | undefined>();
let deleteFolder = $state<LaunchFolder | undefined>();
let saving = $state(false);
// `saving` is shared by every dialog. Each save and each project reset takes a
// new generation, and only the latest generation may clear the busy flag.
let saveGeneration = 0;
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
  manageDefinitions: canEditCatalog,
});

// Dialogs and confirmations hold raw folder/definition IDs that a copied
// project can share, so they never survive a project switch.
let lastProjectId = untrack(() => model.projectId);
$effect(() => {
  const projectId = model.projectId;
  if (projectId === lastProjectId) return;
  lastProjectId = projectId;
  launchDialog = undefined;
  folderDialog = undefined;
  deleteFolder = undefined;
  deleteDefinition = undefined;
  forceKillLaunch = undefined;
  cleanupRunIds = [];
  confirmPruneOpen = false;
  runsDialogOpen = false;
  saveGeneration += 1;
  saving = false;
});

async function saveDefinition(
  input: UpdateLaunchDefinitionRequest,
  parentFolderId: string | null,
): Promise<void> {
  const session = launchDialog;
  if (!session) return;
  const generation = ++saveGeneration;
  saving = true;
  try {
    if (session.kind === "edit") {
      await panelActions.updateDefinition(session.definition, input);
    } else {
      await panelActions.createDefinition({
        ...input,
        parentFolderId,
        beforeSibling: null,
        ...(session.kind === "save-run"
          ? { sourceLaunchId: session.launch.id }
          : {}),
      });
    }
    // A newer dialog (or project switch) must not be closed by this save.
    if (launchDialog === session) launchDialog = undefined;
  } catch {
    // The action layer already notified; keep the dialog open to retry.
  } finally {
    if (generation === saveGeneration) saving = false;
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

function dialogParentFolderId(session: LaunchDialogSession): string | null {
  if (session.kind === "create") return session.parentFolderId ?? null;
  if (session.kind === "duplicate") return session.definition.parentFolderId;
  return null;
}

async function saveFolder(
  label: string,
  parentFolderId: string | null,
): Promise<void> {
  const session = folderDialog;
  if (!session) return;
  const generation = ++saveGeneration;
  saving = true;
  try {
    if (session.kind === "rename")
      await panelActions.renameFolder(session.folder, label);
    else await panelActions.createFolder({ label, parentFolderId });
    if (folderDialog === session) folderDialog = undefined;
  } catch {
    // The action layer already notified (e.g. a name conflict); keep the
    // dialog open so the name can be corrected.
  } finally {
    if (generation === saveGeneration) saving = false;
  }
}

/** Names already taken by the renamed folder's siblings. */
function siblingFolderLabels(folder: LaunchFolder): string[] {
  return siblingsOf(tree, folder.parentFolderId).flatMap((node) =>
    node.kind === "folder" && node.id !== folder.id ? [node.folder.label] : [],
  );
}

async function removeFolder(): Promise<void> {
  if (!deleteFolder) return;
  const folder = deleteFolder;
  deleteFolder = undefined;
  try {
    await panelActions.deleteFolder(folder);
  } catch {
    // Already reported by the action layer.
  }
}

async function removeDefinition(): Promise<void> {
  if (!deleteDefinition) return;
  const definition = deleteDefinition;
  deleteDefinition = undefined;
  try {
    await panelActions.deleteDefinition(definition);
  } catch {
    // Already reported by the action layer.
  }
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
      {#if model.configurationBlocked}
        <!-- The configuration notice is the only content. -->
      {:else if model.definitionsLoading && model.definitions.length === 0}
        <p class="py-1 text-ui text-muted-foreground">Loading launches…</p>
      {:else if model.catalogError && projected.definitions.length === 0 && model.folders.length === 0}
        <!-- No snapshot to show; the banner explains why. -->
      {:else if projected.definitions.length === 0 && model.folders.length === 0}
        <PanelEmpty
          icon={ListTodo}
          title="No launch configurations yet"
          description="Create a launch configuration to run it anytime."
        >
          {#snippet action()}
            <Button
              size="sm"
              variant="outline"
              disabled={!canEditCatalog}
              onclick={() => (launchDialog = { kind: "create" })}
            >
              <Plus />
              New launch
            </Button>
          {/snippet}
        </PanelEmpty>
      {:else}
        <!-- Re-key per project: copied catalogs share IDs, so open menus,
             focus, collapse state, and drags must not carry over. -->
        {#key model.projectId}
          <LaunchDefinitionTree
            nodes={tree}
            {capabilities}
            {activeItemKey}
            {canEditCatalog}
            projectId={model.projectId}
            catalogRevision={model.catalogRevision}
            onOpen={(id) => void panelActions.openLaunchOutput(id)}
            onRun={(definition) => void panelActions.runDefinition(definition)}
            onCancel={(id) => void panelActions.cancelLaunch(id)}
            onForceKill={requestForceKill}
            onRestart={(id) => void panelActions.restartLaunch(id)}
            onEdit={(definition) =>
              (launchDialog = { kind: "edit", definition })}
            onDuplicate={(definition) =>
              (launchDialog = { kind: "duplicate", definition })}
            onDelete={(definition) => (deleteDefinition = definition)}
            onCleanupRuns={(ids) => (cleanupRunIds = ids)}
            onCopy={(text) => void panelActions.copyText(text)}
            onMove={(request) => panelActions.moveEntry(request)}
            onNewLaunch={(parentFolderId) =>
              (launchDialog = { kind: "create", parentFolderId })}
            onNewFolder={(parentFolderId) =>
              (folderDialog = { kind: "create", parentFolderId })}
            onRenameFolder={(folder) =>
              (folderDialog = { kind: "rename", folder })}
            onDeleteFolder={(folder) => (deleteFolder = folder)}
          />
        {/key}
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
              size="sm"
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
  <PanelView>
    {#snippet banner()}
      <PanelHeader
        title="Launches"
        count={model.availability.available
          ? projected.definitions.length
          : undefined}
      >
        {#snippet trailing()}
          {#if model.availability.available}
            <IconAction
              icon={RefreshCw}
              label="Reload launch configurations from disk"
              side="bottom"
              disabled={refreshingDefinitions || model.definitionsLoading}
              onclick={() => void refreshDefinitions()}
            />
            {#if !model.configurationBlocked}
              <IconAction
                icon={FolderPlus}
                label="New folder"
                side="bottom"
                disabled={!canEditCatalog}
                onclick={() =>
                  (folderDialog = { kind: "create", parentFolderId: null })}
              />
              <IconAction
                icon={Plus}
                label="New launch configuration"
                side="bottom"
                disabled={!canEditCatalog}
                onclick={() => (launchDialog = { kind: "create" })}
              />
            {/if}
          {/if}
        {/snippet}
      </PanelHeader>
      {#if !model.availability.available}
        <PanelBanner tone="neutral">{model.availability.message}</PanelBanner>
      {:else}
        {@render configurationNotice?.()}
        {#if model.catalogError}
          <PanelBanner tone="destructive">
            {model.catalogError}
            {projected.definitions.length > 0 || model.folders.length > 0
              ? " Showing the last known launches; editing is disabled."
              : ""}
          </PanelBanner>
        {/if}
        {#if model.notice}
          <PanelBanner tone="info">{model.notice}</PanelBanner>
        {/if}
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
      folders={folderOptions}
      parentFolderId={dialogParentFolderId(session)}
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
      onSave={(input, parentFolderId) =>
        void saveDefinition(input, parentFolderId)}
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
{#if folderDialog}
  {@const session = folderDialog}
  {#key session}
    <LaunchFolderDialog
      open
      mode={session.kind}
      initialLabel={session.kind === "rename" ? session.folder.label : ""}
      parentFolderId={session.kind === "create" ? session.parentFolderId : null}
      folders={folderOptions}
      existingLabels={session.kind === "rename"
        ? siblingFolderLabels(session.folder)
        : []}
      {saving}
      onSave={(label, parentFolderId) => void saveFolder(label, parentFolderId)}
      onOpenChange={(open) => {
        if (!open) folderDialog = undefined;
      }}
    />
  {/key}
{/if}
<ConfirmDialog
  open={Boolean(deleteFolder)}
  destructive
  title="Delete empty folder?"
  description="Only the empty folder is removed. Launch configurations are never deleted with it."
  confirmLabel="Delete folder"
  onConfirm={() => void removeFolder()}
  onCancel={() => (deleteFolder = undefined)}
  onOpenChange={(open) => {
    if (!open) deleteFolder = undefined;
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
