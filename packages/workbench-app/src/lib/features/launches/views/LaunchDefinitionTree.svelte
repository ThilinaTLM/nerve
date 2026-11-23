<script lang="ts">
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import Plus from "@lucide/svelte/icons/plus";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  LaunchCatalogEntryRef,
  LaunchFolder,
} from "@nervekit/contracts/launch-definitions";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import {
  buildPanelItemTree,
  PanelSelectionState,
  PanelToolbarButton,
  PanelTree,
  panelItemNodeId,
  type PanelTreeReorder,
} from "@nervekit/ui-kit/components/composites/panel";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { SvelteSet } from "svelte/reactivity";
import {
  COMPOSER_REFERENCE_DRAG_MIME,
  serializeComposerReferenceDrag,
} from "$lib/presentation/dnd/composer-reference-drag";
import {
  launchBulkMenuItems,
  launchDefinitionMenuItems,
  launchEntryView,
  launchMoveMenuItems,
  type LaunchEntryHandlers,
} from "./launch-menu.js";
import type {
  LaunchEntryCapabilities,
  LaunchPanelActions,
  LaunchPanelDefinition,
} from "./launch-panel-types.js";
import {
  flattenLaunchTree,
  folderSubtreeIds,
  indexLaunchTree,
  launchFolderOptions,
  launchStepTarget,
  nodeKey,
  planLaunchMoves,
  type LaunchDropZone,
  type LaunchMovePlan,
  type LaunchTreeNode,
} from "./launch-tree.js";
import LaunchStatusIcon from "./LaunchStatusIcon.svelte";

type MoveRequest = Parameters<LaunchPanelActions["moveEntry"]>[0];
type FolderNode = Extract<LaunchTreeNode, { kind: "folder" }>;

let {
  nodes,
  capabilities,
  activeItemKey,
  canEditCatalog,
  projectId,
  catalogRevision,
  onOpen,
  onRun,
  onCancel,
  onForceKill,
  onRestart,
  onEdit,
  onDuplicate,
  onDelete,
  onCleanupRuns,
  onCopy,
  onMove,
  onNewLaunch,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  nodes: readonly LaunchTreeNode[];
  capabilities: LaunchEntryCapabilities;
  activeItemKey?: string;
  /** Structural edits need manage capability and a valid catalog revision. */
  canEditCatalog: boolean;
  /** Copied projects can share IDs and revisions; identity is project-qualified. */
  projectId?: string;
  /** Revision of the snapshot `nodes` was built from. */
  catalogRevision?: string;
  onOpen: (launchId: string) => void;
  onRun: (definition: LaunchPanelDefinition) => void;
  onCancel: (launchId: string) => void;
  onForceKill: (launchId: string) => void;
  onRestart: (launchId: string) => void;
  onEdit: (definition: LaunchPanelDefinition) => void;
  onDuplicate: (definition: LaunchPanelDefinition) => void;
  /** One confirmation for the whole set. */
  onDelete: (definitions: readonly LaunchPanelDefinition[]) => void;
  onCleanupRuns: (launchIds: readonly string[]) => void;
  onCopy: (text: string) => void;
  onMove: (request: MoveRequest) => void | Promise<void>;
  onNewLaunch: (parentFolderId: string | null) => void;
  onNewFolder: (parentFolderId: string | null) => void;
  onRenameFolder: (folder: LaunchFolder) => void;
  onDeleteFolder: (folder: LaunchFolder) => void;
} = $props();

// Folders start open; only the ones the user closed are tracked.
const collapsed = new SvelteSet<string>();
const selection = new PanelSelectionState();

const flat = $derived(flattenLaunchTree(nodes));
const index = $derived(indexLaunchTree(nodes));
const panelNodes = $derived(
  buildPanelItemTree(flat, {
    getKey: nodeKey,
    getParentKey: (node) =>
      node.parentId === null ? undefined : `folder:${node.parentId}`,
    getLabel: labelOf,
    isExpandable: (node) => node.kind === "folder",
  }),
);
const expandedIds = $derived(
  new Set(
    flat
      .filter((node) => node.kind === "folder" && !collapsed.has(node.id))
      .map(nodeId),
  ),
);
const editable = $derived(canEditCatalog && capabilities.manageDefinitions);

function nodeId(node: LaunchCatalogEntryRef): string {
  return panelItemNodeId(nodeKey(node));
}

function labelOf(node: LaunchTreeNode): string {
  return node.kind === "folder"
    ? node.folder.label
    : launchEntryView(node.entry).label.text;
}

const ref = (node: LaunchTreeNode): LaunchCatalogEntryRef => ({
  kind: node.kind,
  id: node.id,
});

// Reveal the selected launch when it sits inside a collapsed folder.
let revealed: string | undefined;
$effect(() => {
  const key = activeItemKey;
  if (key === revealed) return;
  revealed = key;
  let parent = key ? index.get(`definition:${key}`)?.parentId : undefined;
  while (parent) {
    collapsed.delete(parent);
    parent = index.get(`folder:${parent}`)?.parentId;
  }
});

$effect(() => {
  for (const id of collapsed)
    if (!index.has(`folder:${id}`)) collapsed.delete(id);
});

/** The rows an action on `node` applies to: the selection when it contains the row. */
function targetsFor(node: LaunchTreeNode): LaunchTreeNode[] {
  if (!selection.has(nodeId(node)) || selection.size < 2) return [node];
  return flat.filter((candidate) => selection.has(nodeId(candidate)));
}

const definitionsOf = (targets: readonly LaunchTreeNode[]) =>
  targets.flatMap((node) => (node.kind === "definition" ? [node.entry] : []));

// --- moves ----------------------------------------------------------------

async function submitMove(
  plan: LaunchMovePlan | undefined,
  expectedRevision: string | undefined = catalogRevision,
): Promise<void> {
  if (!plan || plan.noop || !canEditCatalog) return;
  if (plan.destinationFolderId) collapsed.delete(plan.destinationFolderId);
  try {
    // Each move changes the catalog revision: only the first one is bound to
    // the revision the placement was planned on; later ones follow the latest.
    for (const [at, entry] of plan.entries.entries())
      await onMove({
        ...(at === 0 && expectedRevision !== undefined
          ? { expectedRevision }
          : {}),
        entry,
        destinationFolderId: plan.destinationFolderId,
        beforeSibling: plan.beforeSibling,
      });
  } catch {
    // Failures are already reported by the action layer; a rejected move
    // simply leaves the tree as the refreshed catalog shows it.
  }
}

function moveTo(targets: readonly LaunchTreeNode[], folderId: string | null) {
  void submitMove(
    planLaunchMoves(nodes, targets.map(ref), {
      ref: folderId === null ? undefined : { kind: "folder", id: folderId },
      zone: "inside",
    }),
  );
}

function step(node: LaunchTreeNode, direction: "up" | "down") {
  const target = launchStepTarget(nodes, ref(node), direction);
  return target
    ? () => void submitMove(planLaunchMoves(nodes, [ref(node)], target))
    : undefined;
}

function moveMenu(
  targets: readonly LaunchTreeNode[],
  single?: LaunchTreeNode,
): ContextMenuItem[] {
  const unreachable = new Set(
    targets.flatMap((target) =>
      target.kind === "folder" ? [...folderSubtreeIds(nodes, target.id)] : [],
    ),
  );
  const parents = new Set(targets.map((target) => target.parentId));
  return launchMoveMenuItems({
    disabled: !canEditCatalog,
    folders: launchFolderOptions(nodes).filter(
      (option) => !unreachable.has(option.id),
    ),
    currentFolderId: parents.size === 1 ? [...parents][0] : undefined,
    onMoveToFolder: (folderId) => moveTo(targets, folderId),
    onStep: single
      ? { up: step(single, "up"), down: step(single, "down") }
      : undefined,
  });
}

// Revision the drag intent was captured against; submitted with the drop.
let dragContext: { revision?: string; projectId?: string } | undefined;

const reorder: PanelTreeReorder<LaunchTreeNode> = {
  canDrag: () => editable,
  getSources: targetsFor,
  canDrop: (sources, target, zone) => {
    // The catalog changed under an in-flight drag: the previewed placement was
    // computed from an older tree, so reject it rather than replay it elsewhere.
    if (
      dragContext &&
      (dragContext.revision !== catalogRevision ||
        dragContext.projectId !== projectId)
    )
      return false;
    const plan = planLaunchMoves(nodes, sources.map(ref), {
      ref: target && ref(target),
      zone: zone satisfies LaunchDropZone,
    });
    return plan !== undefined && !plan.noop;
  },
  onMove: (sources, target, zone) =>
    void submitMove(
      planLaunchMoves(nodes, sources.map(ref), {
        ref: target && ref(target),
        zone,
      }),
      dragContext ? dragContext.revision : catalogRevision,
    ),
  onDragStart: () => (dragContext = { revision: catalogRevision, projectId }),
  onDragEnd: () => (dragContext = undefined),
};

/** Dragging launches out of the tree mentions them in the composer. */
function startComposerDrag(event: DragEvent, node: LaunchTreeNode): void {
  if (!event.dataTransfer) return;
  if (!selection.has(nodeId(node))) selection.selectOnly(nodeId(node));
  const entries = definitionsOf(targetsFor(node));
  if (entries.length === 0) return;
  const data = event.dataTransfer;
  data.setData(
    COMPOSER_REFERENCE_DRAG_MIME,
    serializeComposerReferenceDrag(
      entries.map((entry) => ({
        type: "launch",
        id: entry.definition.id,
        label: launchEntryView(entry).label.text,
        title: entry.definition.command,
      })),
    ),
  );
  data.setData(
    "text/plain",
    entries.map((entry) => `@launch:${entry.definition.id}`).join(" "),
  );
  data.effectAllowed = editable ? "copyMove" : "copy";
}

// --- menus ----------------------------------------------------------------

const handlers: LaunchEntryHandlers = {
  onOpen: (launchId) => onOpen(launchId),
  onRun: (entry) => onRun(entry.definition),
  onCancel: (launchId) => onCancel(launchId),
  onForceKill: (launchId) => onForceKill(launchId),
  onRestart: (launchId) => onRestart(launchId),
  onEdit: (entry) => onEdit(entry.definition),
  onDuplicate: (entry) => onDuplicate(entry.definition),
  onDelete: (entries) => onDelete(entries.map((entry) => entry.definition)),
  onCleanupRuns: (launchIds) => onCleanupRuns(launchIds),
  onCopy: (text) => onCopy(text),
};

function folderMenu(node: FolderNode): ContextMenuItem[] {
  const manage = !canEditCatalog || !capabilities.manageDefinitions;
  return [
    {
      label: "New launch inside",
      icon: Plus,
      disabled: manage,
      onSelect: () => onNewLaunch(node.id),
    },
    {
      label: "New folder inside",
      icon: FolderPlus,
      disabled: manage,
      onSelect: () => onNewFolder(node.id),
    },
    { type: "separator" },
    {
      label: "Rename folder",
      icon: Pencil,
      shortcut: "F2",
      disabled: manage,
      onSelect: () => onRenameFolder(node.folder),
    },
    ...moveMenu([node], node),
    { type: "separator" },
    {
      label: "Delete empty folder",
      icon: Trash2,
      destructive: true,
      disabled: manage || node.children.length > 0,
      onSelect: () => onDeleteFolder(node.folder),
    },
  ];
}

function menuFor(node: LaunchTreeNode): ContextMenuItem[] {
  const targets = targetsFor(node);
  if (targets.length > 1) {
    const bulk = launchBulkMenuItems(
      definitionsOf(targets),
      capabilities,
      handlers,
    );
    return [
      ...bulk,
      ...(bulk.length > 0 ? [{ type: "separator" as const }] : []),
      ...moveMenu(targets),
    ];
  }
  if (node.kind === "folder") return folderMenu(node);
  return [
    ...launchDefinitionMenuItems(node.entry, capabilities, handlers),
    { type: "separator" },
    ...moveMenu([node], node),
  ];
}

const emptyAreaMenu = $derived<ContextMenuItem[]>(
  canEditCatalog
    ? [
        {
          label: "New launch here",
          icon: Plus,
          disabled: !capabilities.manageDefinitions,
          onSelect: () => onNewLaunch(null),
        },
        {
          label: "New folder here",
          icon: FolderPlus,
          disabled: !capabilities.manageDefinitions,
          onSelect: () => onNewFolder(null),
        },
      ]
    : [],
);

// --- tree hooks -----------------------------------------------------------

function activate(node: LaunchTreeNode): void {
  if (node.kind === "definition" && node.entry.latestRun)
    onOpen(node.entry.latestRun.id);
}

function handleKeydown(event: KeyboardEvent, node: LaunchTreeNode): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return false;
  if (event.key === "F2" && node.kind === "folder" && canEditCatalog) {
    onRenameFolder(node.folder);
    return true;
  }
  if (event.key === "Delete" && editable) {
    const targets = targetsFor(node);
    const entries = definitionsOf(targets);
    if (entries.length > 0) onDelete(entries.map((entry) => entry.definition));
    else if (
      targets.length === 1 &&
      node.kind === "folder" &&
      node.children.length === 0
    )
      onDeleteFolder(node.folder);
    else return false;
    return true;
  }
  return false;
}

function title(node: LaunchTreeNode): string {
  return node.kind === "definition" ? launchEntryView(node.entry).tooltip : "";
}
</script>

{#snippet leading(node: LaunchTreeNode)}
  {#if node.kind === "folder"}
    {#if expandedIds.has(nodeId(node))}
      <FolderOpen class="size-3.5" aria-hidden="true" />
    {:else}
      <Folder class="size-3.5" aria-hidden="true" />
    {/if}
  {:else}
    <LaunchStatusIcon status={launchEntryView(node.entry).status} />
  {/if}
{/snippet}

{#snippet label(node: LaunchTreeNode)}
  {#if node.kind === "definition" && launchEntryView(node.entry).label.isCommand}
    <span class="font-mono">{labelOf(node)}</span>
  {:else}
    {labelOf(node)}
  {/if}
{/snippet}

{#snippet badges(node: LaunchTreeNode)}
  {#if node.kind === "folder"}
    {#if node.activeCount > 0}
      <Badge
        variant="info"
        title={`${node.activeCount} active ${node.activeCount === 1 ? "run" : "runs"}`}
        aria-label={`${node.activeCount} active ${node.activeCount === 1 ? "run" : "runs"}`}
        >{node.activeCount}</Badge
      >
    {/if}
  {:else}
    {#if node.entry.activeRuns.length > 1}
      <Badge variant="info">{node.entry.activeRuns.length} running</Badge>
    {/if}
    {#if node.entry.runs.length > 1}
      <Badge variant="neutral">
        <History class="mr-1 size-3" />{node.entry.runs.length}
      </Badge>
    {/if}
  {/if}
{/snippet}

{#snippet actions(node: LaunchTreeNode)}
  {#if node.kind === "definition"}
    {@const view = launchEntryView(node.entry)}
    {#if view.activeRun?.status === "stopping"}
      <PanelToolbarButton
        icon={Skull}
        label="Force kill launch"
        dense
        disabled={!capabilities.cancel}
        onclick={() => onForceKill(view.activeRun!.id)}
      />
    {:else if view.activeRun}
      <PanelToolbarButton
        icon={RotateCw}
        label="Restart launch"
        dense
        disabled={!capabilities.restart}
        onclick={() => onRestart(view.activeRun!.id)}
      />
      <PanelToolbarButton
        icon={Square}
        label="Stop launch"
        dense
        disabled={!capabilities.cancel}
        onclick={() => onCancel(view.activeRun!.id)}
      />
    {:else if view.canStart}
      <PanelToolbarButton
        icon={Play}
        label={view.runLabel}
        dense
        disabled={!capabilities.start}
        onclick={() => onRun(node.entry.definition)}
      />
    {/if}
  {/if}
{/snippet}

<PanelTree
  nodes={panelNodes}
  ariaLabel="Launch configurations"
  showDisclosure={false}
  {expandedIds}
  onItemExpansionChange={(node, open) => {
    if (node.kind !== "folder") return;
    if (open) collapsed.delete(node.id);
    else collapsed.add(node.id);
  }}
  {selection}
  {reorder}
  emptyAreaMenuItems={emptyAreaMenu}
  getItemActive={(node) =>
    node.kind === "definition" && activeItemKey === node.entry.key}
  getItemSelected={(node) =>
    // The open launch reads as selected only while no multi-selection is in play, so the
    // highlighted rows are always the ones bulk actions apply to.
    selection.size < 2 &&
    node.kind === "definition" &&
    activeItemKey === node.entry.key}
  getItemTone={(node) =>
    node.kind === "definition" && launchEntryView(node.entry).label.isCommand
      ? "neutral"
      : undefined}
  getItemTitle={title}
  getItemDraggable={(node) => node.kind === "definition"}
  onItemDragStart={startComposerDrag}
  onItemActivate={activate}
  onItemKeydown={handleKeydown}
  getItemMenuItems={menuFor}
  itemLeading={leading}
  itemLabel={label}
  itemBadges={badges}
  itemActions={actions}
/>
