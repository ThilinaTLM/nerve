<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import FolderInput from "@lucide/svelte/icons/folder-input";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  LaunchCatalogEntryRef,
  LaunchFolder,
} from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import { cn } from "@nervekit/ui-kit/utils";
import { SvelteSet } from "svelte/reactivity";
import LaunchDefinitionRow from "./LaunchDefinitionRow.svelte";
import LaunchFolderRow from "./LaunchFolderRow.svelte";
import type {
  LaunchEntryCapabilities,
  LaunchPanelActions,
  LaunchPanelDefinition,
} from "./launch-panel-types.js";
import {
  describeLaunchDrop,
  flattenLaunchTree,
  indexLaunchTree,
  launchFolderOptions,
  nodeKey,
  planLaunchMove,
  planLaunchStep,
  type LaunchDropPlan,
  type LaunchDropZone,
  type LaunchTreeNode,
} from "./launch-tree.js";

type MoveRequest = Parameters<LaunchPanelActions["moveEntry"]>[0];

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
  onDelete: (definition: LaunchPanelDefinition) => void;
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
let focusedKey = $state<string>();
let root = $state<HTMLElement | null>(null);
let dragged = $state<LaunchCatalogEntryRef>();
// Revision the drag intent was captured against; submitted with the drop.
let dragRevision: string | undefined;
let dragProjectId: string | undefined;
let drop = $state<{
  rowKey: string | "root";
  zone: LaunchDropZone;
  plan: LaunchDropPlan;
}>();

const index = $derived(indexLaunchTree(nodes));
const expandedIds = $derived(
  new Set(
    [...index.values()]
      .filter((node) => node.kind === "folder" && !collapsed.has(node.id))
      .map((node) => node.id),
  ),
);
const rows = $derived(flattenLaunchTree(nodes, expandedIds));
const tabKey = $derived(
  focusedKey && rows.some((row) => nodeKey(row.node) === focusedKey)
    ? focusedKey
    : rows[0] && nodeKey(rows[0].node),
);
const preview = $derived.by(() => {
  if (!dragged || !drop) return undefined;
  const node = index.get(nodeKey(dragged));
  if (!node) return undefined;
  const name =
    node.kind === "folder"
      ? node.folder.label
      : node.entry.definition.label?.trim() || node.entry.definition.command;
  return `Move “${name}” ${describeLaunchDrop(nodes, drop.plan)}`;
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

function toggle(id: string, open = collapsed.has(id)): void {
  if (open) collapsed.delete(id);
  else collapsed.add(id);
}

function submitMove(
  ref: LaunchCatalogEntryRef,
  plan: LaunchDropPlan | undefined,
  expectedRevision: string | undefined = catalogRevision,
) {
  if (!plan || plan.noop || !canEditCatalog) return;
  if (plan.destinationFolderId) collapsed.delete(plan.destinationFolderId);
  // Failures are already reported by the action layer; a rejected move
  // simply leaves the tree as the refreshed catalog shows it.
  // Deferring the call also catches a synchronous throw from the handler.
  void Promise.resolve()
    .then(() =>
      onMove({
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        entry: ref,
        destinationFolderId: plan.destinationFolderId,
        beforeSibling: plan.beforeSibling,
      }),
    )
    .catch(() => undefined);
}

function moveItems(node: LaunchTreeNode): ContextMenuItem[] {
  const ref = { kind: node.kind, id: node.id };
  const destinations = [
    {
      type: "item" as const,
      label: "Top level",
      disabled: !canEditCatalog || node.parentId === null,
      onSelect: () =>
        submitMove(ref, planLaunchMove(nodes, ref, { zone: "root" })),
    },
    ...launchFolderOptions(
      nodes,
      node.kind === "folder" ? node.id : undefined,
    ).map((option) => ({
      type: "item" as const,
      label: option.label,
      disabled: !canEditCatalog || node.parentId === option.id,
      onSelect: () =>
        submitMove(
          ref,
          planLaunchMove(nodes, ref, {
            ref: { kind: "folder", id: option.id },
            zone: "inside",
          }),
        ),
    })),
  ];
  const up = planLaunchStep(nodes, ref, "up");
  const down = planLaunchStep(nodes, ref, "down");
  return [
    {
      type: "submenu",
      label: "Move to",
      icon: FolderInput,
      disabled: !canEditCatalog,
      items: destinations,
    },
    {
      label: "Move up",
      icon: ArrowUp,
      shortcut: "Alt+↑",
      disabled: !canEditCatalog || !up,
      onSelect: () => submitMove(ref, up),
    },
    {
      label: "Move down",
      icon: ArrowDown,
      shortcut: "Alt+↓",
      disabled: !canEditCatalog || !down,
      onSelect: () => submitMove(ref, down),
    },
  ];
}

function folderMenu(
  node: Extract<LaunchTreeNode, { kind: "folder" }>,
): ContextMenuItem[] {
  return [
    {
      label: "New launch inside",
      icon: Plus,
      disabled: !canEditCatalog || !capabilities.manageDefinitions,
      onSelect: () => onNewLaunch(node.id),
    },
    {
      label: "New folder inside",
      icon: FolderPlus,
      disabled: !canEditCatalog || !capabilities.manageDefinitions,
      onSelect: () => onNewFolder(node.id),
    },
    { type: "separator" },
    {
      label: "Rename folder",
      icon: Pencil,
      shortcut: "F2",
      disabled: !canEditCatalog || !capabilities.manageDefinitions,
      onSelect: () => onRenameFolder(node.folder),
    },
    ...moveItems(node),
    { type: "separator" },
    {
      label: "Delete empty folder",
      icon: Trash2,
      destructive: true,
      disabled:
        !canEditCatalog ||
        !capabilities.manageDefinitions ||
        node.children.length > 0,
      onSelect: () => onDeleteFolder(node.folder),
    },
  ];
}

const backgroundMenu = $derived<ContextMenuItem[]>([
  {
    label: "New launch here",
    icon: Plus,
    disabled: !canEditCatalog || !capabilities.manageDefinitions,
    onSelect: () => onNewLaunch(null),
  },
  {
    label: "New folder here",
    icon: FolderPlus,
    disabled: !canEditCatalog || !capabilities.manageDefinitions,
    onSelect: () => onNewFolder(null),
  },
]);

const dragEnabled = $derived(canEditCatalog && capabilities.manageDefinitions);

// --- drag and drop -------------------------------------------------------

function startDrag(event: DragEvent, node: LaunchTreeNode): void {
  if (!dragEnabled || !event.dataTransfer) return event.preventDefault();
  dragged = { kind: node.kind, id: node.id };
  dragRevision = catalogRevision;
  dragProjectId = projectId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", node.id);
}

// The catalog changed under an in-flight drag: the previewed placement was
// computed from an older tree, so cancel it rather than replay it elsewhere.
$effect(() => {
  if (
    dragged &&
    (!canEditCatalog ||
      catalogRevision !== dragRevision ||
      projectId !== dragProjectId)
  )
    endDrag();
});

function endDrag(): void {
  dragged = undefined;
  drop = undefined;
}

function zoneFor(event: DragEvent, node: LaunchTreeNode): LaunchDropZone {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio =
    rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  if (node.kind === "folder")
    return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
  return ratio < 0.5 ? "before" : "after";
}

function overRow(event: DragEvent, node: LaunchTreeNode): void {
  if (!dragged) return;
  const zone = zoneFor(event, node);
  const plan = planLaunchMove(nodes, dragged, {
    ref: { kind: node.kind, id: node.id },
    zone,
    expanded: node.kind === "folder" && expandedIds.has(node.id),
  });
  if (!plan || plan.noop) {
    drop = undefined;
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  drop = { rowKey: nodeKey(node), zone, plan };
}

function overRoot(event: DragEvent): void {
  if (!dragged) return;
  const plan = planLaunchMove(nodes, dragged, { zone: "root" });
  if (!plan || plan.noop) {
    drop = undefined;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  drop = { rowKey: "root", zone: "root", plan };
}

function performDrop(event: DragEvent): void {
  if (!dragged || !drop) return;
  event.preventDefault();
  event.stopPropagation();
  const ref = dragged;
  const plan = drop.plan;
  const revision = dragRevision;
  endDrag();
  submitMove(ref, plan, revision);
}

function leaveTree(event: DragEvent): void {
  if (!root?.contains(event.relatedTarget as Node | null)) drop = undefined;
}

/** Indentation of the insertion line, matching the row inset. */
function lineDepth(row: { depth: number; node: LaunchTreeNode }): number {
  return drop?.zone === "after" &&
    row.node.kind === "folder" &&
    expandedIds.has(row.node.id) &&
    row.node.children.length > 0
    ? row.depth + 1
    : row.depth;
}

// --- keyboard ------------------------------------------------------------

function focusRow(key: string | undefined): void {
  if (!key) return;
  focusedKey = key;
  root
    ?.querySelector<HTMLElement>(`[data-panel-row-id="${CSS.escape(key)}"]`)
    ?.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  const key = target.dataset?.panelRowId;
  if (!key) return;
  const at = rows.findIndex((row) => nodeKey(row.node) === key);
  const row = rows[at];
  if (!row) return;
  const node = row.node;
  const ref = { kind: node.kind, id: node.id };

  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    submitMove(
      ref,
      planLaunchStep(nodes, ref, event.key === "ArrowUp" ? "up" : "down"),
    );
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  switch (event.key) {
    case "ArrowDown":
      focusRow(rows[at + 1] && nodeKey(rows[at + 1]!.node));
      break;
    case "ArrowUp":
      focusRow(rows[at - 1] && nodeKey(rows[at - 1]!.node));
      break;
    case "Home":
      focusRow(nodeKey(rows[0]!.node));
      break;
    case "End":
      focusRow(nodeKey(rows[rows.length - 1]!.node));
      break;
    case "ArrowRight":
      if (node.kind === "folder" && collapsed.has(node.id)) toggle(node.id);
      else if (node.kind === "folder" && node.children.length > 0)
        focusRow(nodeKey(node.children[0]!));
      else return;
      break;
    case "ArrowLeft":
      if (
        node.kind === "folder" &&
        !collapsed.has(node.id) &&
        node.children.length > 0
      )
        toggle(node.id);
      else if (node.parentId) focusRow(`folder:${node.parentId}`);
      else return;
      break;
    case "Enter":
    case " ": {
      if (node.kind === "folder") toggle(node.id);
      else {
        const latest: LaunchRecord | undefined = node.entry.latestRun;
        if (latest) onOpen(latest.id);
      }
      break;
    }
    case "F2":
      if (node.kind === "folder" && canEditCatalog) onRenameFolder(node.folder);
      else return;
      break;
    default:
      return;
  }
  event.preventDefault();
}
</script>

<div
  bind:this={root}
  role="tree"
  tabindex="-1"
  aria-label="Launch configurations"
  class="flex min-w-0 flex-col"
  onkeydown={handleKeydown}
  onfocusin={(event) => {
    const key = (event.target as HTMLElement).dataset?.panelRowId;
    if (key) focusedKey = key;
  }}
  ondragleave={leaveTree}
>
  <div class="flex min-w-0 flex-col py-0.5">
    {#each rows as row (nodeKey(row.node))}
      {@const node = row.node}
      {@const key = nodeKey(node)}
      {@const target = drop?.rowKey === key ? drop.zone : undefined}
      <div
        class={cn(
          "relative rounded-sm transition-colors motion-reduce:transition-none",
          dragged && key === nodeKey(dragged) && "opacity-50",
          target === "inside" && "bg-primary/10 ring-1 ring-primary ring-inset",
        )}
        role="none"
        draggable={dragEnabled}
        ondragstart={(event) => startDrag(event, node)}
        ondragend={endDrag}
        ondragover={(event) => overRow(event, node)}
        ondrop={performDrop}
      >
        {#if target === "before" || target === "after"}
          <div
            aria-hidden="true"
            class={cn(
              "pointer-events-none absolute right-1 z-10 h-0.5 rounded-full bg-primary",
              target === "before" ? "-top-px" : "-bottom-px",
            )}
            style:left={`calc(var(--spacing) * ${2 + lineDepth(row) * 3})`}
          ></div>
        {/if}
        {#if node.kind === "folder"}
          <LaunchFolderRow
            folderId={node.id}
            label={node.folder.label}
            expanded={expandedIds.has(node.id)}
            depth={row.depth}
            position={row.position}
            setSize={row.setSize}
            tabindex={tabKey === key ? 0 : -1}
            activeCount={node.activeCount}
            menuItems={folderMenu(node)}
            onToggle={() => toggle(node.id)}
          />
        {:else}
          <LaunchDefinitionRow
            entry={node.entry}
            {capabilities}
            active={activeItemKey === node.entry.key}
            depth={row.depth}
            position={row.position}
            setSize={row.setSize}
            tabindex={tabKey === key ? 0 : -1}
            moveItems={moveItems(node)}
            {onOpen}
            onRun={() => onRun(node.entry.definition)}
            {onCancel}
            {onForceKill}
            {onRestart}
            onEdit={() => onEdit(node.entry.definition)}
            onDuplicate={() => onDuplicate(node.entry.definition)}
            onDelete={() => onDelete(node.entry.definition)}
            {onCleanupRuns}
            {onCopy}
          />
        {/if}
      </div>
    {/each}
  </div>

  <ContextMenuList
    items={backgroundMenu}
    triggerClass="block"
    disabled={!canEditCatalog}
  >
    <div
      role="none"
      class={cn(
        "min-h-6 rounded-sm transition-colors motion-reduce:transition-none",
        drop?.rowKey === "root" &&
          "bg-primary/10 ring-1 ring-primary ring-inset",
      )}
      ondragover={overRoot}
      ondrop={performDrop}
    ></div>
  </ContextMenuList>

  {#if preview}
    <div
      role="status"
      class="sticky bottom-0 z-20 truncate rounded-sm bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm ring-1 ring-border"
    >
      {preview}
    </div>
  {/if}
</div>
