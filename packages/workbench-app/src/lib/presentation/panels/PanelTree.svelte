<script lang="ts" module>
export type PanelTreeController = {
  /** Scrolls the row into view and, with `focus`, moves keyboard focus to it. */
  revealRow: (id: string, options?: { focus?: boolean }) => Promise<void>;
};
</script>

<script lang="ts" generics="T">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { cn } from "@nervekit/ui-kit/utils";
import { tick, type Snippet } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import PanelRow from "./PanelRow.svelte";
import {
  adjacentPanelTreeRowId,
  expandedPanelTreeIds,
  firstPanelTreeChildId,
  panelTreeExpandableIds,
  parentPanelTreeRowId,
  typeaheadPanelTreeRowId,
  visiblePanelTreeRows,
  type PanelTreeNode,
  type PanelTreeRow,
} from "./panel-tree.js";

type Props = {
  /** Prebuilt nodes from `buildPanelTree` (paths) or `buildPanelItemTree`. */
  nodes: readonly PanelTreeNode<T>[];
  ariaLabel: string;
  /** Indentation steps applied to root rows, for trees nested under a header. */
  baseIndent?: number;
  getItemTitle?: (item: T) => string;
  getItemSelected?: (item: T) => boolean;
  getItemTone?: (item: T) => StatusTone | undefined;
  /** Controlled expansion state. Node ids are the ids produced by the builders. */
  expandedIds?: ReadonlySet<string>;
  onItemExpansionChange?: (item: T, expanded: boolean) => void;
  /** Expansion changes for generated path groups. */
  onGroupExpansionChange?: (path: readonly string[], expanded: boolean) => void;
  /** Opt into a single fixed-height virtualized viewport for large trees. */
  virtualized?: boolean;
  /** Allow deeply indented rows to scroll horizontally instead of clipping. */
  horizontalScroll?: boolean;
  /** Hide item disclosure arrows when open/closed leading icons carry state. */
  showDisclosure?: boolean;
  /** Hide generated-directory chevrons when folder icons carry state. */
  showGroupDisclosure?: boolean;
  itemMono?: boolean;
  /**
   * Activates a leaf or item parent. Item parents also toggle their children on
   * the same click, so selecting and disclosing stay a single gesture.
   */
  onItemActivate?: (item: T) => void;
  getItemDraggable?: (item: T) => boolean;
  onItemDragStart?: (event: DragEvent, item: T) => void;
  onItemDragEnd?: (event: DragEvent, item: T) => void;
  /** Row drop-target handlers; the tree only forwards the events. */
  onItemDragEnter?: (event: DragEvent, item: T) => void;
  onItemDragOver?: (event: DragEvent, item: T) => void;
  onItemDragLeave?: (event: DragEvent, item: T) => void;
  onItemDrop?: (event: DragEvent, item: T) => void;
  getItemDropTarget?: (item: T) => boolean;
  /** Recedes the row (e.g. ignored files). */
  getItemDimmed?: (item: T) => boolean;
  /** Rows for which `itemEditor` replaces the label. */
  getItemEditing?: (item: T) => boolean;
  itemEditor?: Snippet<[T]>;
  /**
   * Called before the default pointer handling; return true to consume the
   * click (modifier-click selection) so the row is neither activated nor toggled.
   */
  onItemClick?: (event: MouseEvent, item: T) => boolean | void;
  /**
   * Called for keys on a focused row before the built-in navigation; return
   * true to consume the key. Receives the rows currently visible.
   */
  onItemKeydown?: (event: KeyboardEvent, item: T) => boolean | void;
  /** Allows more than one selected row (adds `aria-multiselectable`). */
  multiselectable?: boolean;
  /** Bindable imperative handle for scroll-to-row and focus. */
  controller?: PanelTreeController;
  itemLeading?: Snippet<[T]>;
  /** Segmented label (e.g. highlighted search matches); the node label stays the accessible fallback. */
  itemLabel?: Snippet<[T]>;
  itemBadges?: Snippet<[T]>;
  itemActions?: Snippet<[T]>;
  /** Actions for generated directory groups, receiving the full path. */
  groupActions?: Snippet<[readonly string[]]>;
  /** Overlay row actions so hidden controls reserve no horizontal space. */
  overlayActions?: boolean;
  getItemMenuItems?: (item: T) => ContextMenuItem[];
  getGroupMenuItems?: (path: readonly string[]) => ContextMenuItem[];
  class?: string;
};

/* eslint-disable no-useless-assignment -- $bindable defaults declare parent bindings before the effect assigns the handle. */
let {
  nodes,
  ariaLabel,
  baseIndent = 0,
  getItemTitle,
  getItemSelected,
  getItemTone,
  expandedIds,
  onItemExpansionChange,
  onGroupExpansionChange,
  virtualized = false,
  horizontalScroll = false,
  showDisclosure = true,
  showGroupDisclosure = true,
  itemMono = false,
  onItemActivate,
  getItemDraggable,
  onItemDragStart,
  onItemDragEnd,
  onItemDragEnter,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
  getItemDropTarget,
  getItemDimmed,
  getItemEditing,
  itemEditor,
  onItemClick,
  onItemKeydown,
  multiselectable = false,
  controller = $bindable(),
  itemLeading,
  itemLabel,
  itemBadges,
  itemActions,
  groupActions,
  overlayActions = false,
  getItemMenuItems,
  getGroupMenuItems,
  class: className,
}: Props = $props();
/* eslint-enable no-useless-assignment */

let root: HTMLElement | undefined = $state();
let virtualController = $state<VirtualScrollerController>();
const collapsed = new SvelteSet<string>();
let focusedId = $state<string>();

const expandableIds = $derived(panelTreeExpandableIds(nodes));
const expanded = $derived.by(() => {
  if (expandedIds)
    return new Set([...expandedIds].filter((id) => expandableIds.has(id)));
  return expandedPanelTreeIds(expandableIds, collapsed);
});
const rows = $derived(visiblePanelTreeRows(nodes, expanded));
/** Reserve the chevron column so leaf rows align with expandable siblings. */
const hasExpandableItems = $derived(
  showDisclosure &&
    rows.some((row) => row.node.kind === "item" && isExpandable(row.node)),
);
$effect(() => {
  for (const id of collapsed) if (!expandableIds.has(id)) collapsed.delete(id);
});

$effect(() => {
  const visibleIds = new Set(rows.map((row) => row.node.id));
  if (!focusedId || !visibleIds.has(focusedId)) focusedId = rows[0]?.node.id;
});

function notifyExpansionChange(node: PanelTreeNode<T>, open: boolean): void {
  if (node.kind === "item") onItemExpansionChange?.(node.value, open);
  else onGroupExpansionChange?.(node.path, open);
}

function setExpanded(node: PanelTreeNode<T>, open: boolean): void {
  if (expandedIds) {
    notifyExpansionChange(node, open);
    return;
  }
  if (open) collapsed.delete(node.id);
  else collapsed.add(node.id);
  notifyExpansionChange(node, open);
}

function isExpandable(node: PanelTreeNode<T>): boolean {
  return (
    node.children.length > 0 ||
    (node.kind === "item" && node.expandable === true)
  );
}

function toggle(node: PanelTreeNode<T>): void {
  if (isExpandable(node)) setExpanded(node, !expanded.has(node.id));
}

function activate(node: PanelTreeNode<T>): void {
  if (node.kind === "item") onItemActivate?.(node.value);
  toggle(node);
}

async function focusRow(
  id: string | undefined,
  options: { focus?: boolean } = {},
): Promise<void> {
  if (!id) return;
  const index = rows.findIndex((row) => row.node.id === id);
  if (index < 0) return;
  if (options.focus !== false) focusedId = id;
  if (virtualized) virtualController?.scrollToIndex(index, { align: "auto" });
  await tick();
  if (virtualized) await tick();
  const element = [
    ...(root?.querySelectorAll<HTMLElement>("[data-panel-row-id]") ?? []),
  ].find((candidate) => candidate.dataset.panelRowId === id);
  if (options.focus === false) element?.scrollIntoView({ block: "nearest" });
  else element?.focus();
}

$effect(() => {
  controller = {
    revealRow: (id, options) => focusRow(id, options),
  };
});

const TYPEAHEAD_RESET_MS = 700;
let typeaheadBuffer = "";
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

function typeahead(event: KeyboardEvent, node: PanelTreeNode<T>): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1)
    return false;
  if (event.key === " " && typeaheadBuffer === "") return false;
  typeaheadBuffer += event.key;
  clearTimeout(typeaheadTimer);
  typeaheadTimer = setTimeout(() => (typeaheadBuffer = ""), TYPEAHEAD_RESET_MS);
  const destination = typeaheadPanelTreeRowId(rows, node.id, typeaheadBuffer);
  if (destination) void focusRow(destination);
  return true;
}

function activateFromPointer(event: MouseEvent, node: PanelTreeNode<T>): void {
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    "[data-panel-row-id]",
  );
  focusedId = node.id;
  row?.focus();
  if (node.kind === "item" && onItemClick?.(event, node.value) === true) return;
  activate(node);
}

function handleKeydown(event: KeyboardEvent, node: PanelTreeNode<T>): void {
  if (event.target !== event.currentTarget) return;
  if (node.kind === "item" && onItemKeydown?.(event, node.value) === true) {
    event.preventDefault();
    return;
  }

  let destination: string | undefined;
  switch (event.key) {
    case "ArrowDown":
      destination = adjacentPanelTreeRowId(rows, node.id, "next");
      break;
    case "ArrowUp":
      destination = adjacentPanelTreeRowId(rows, node.id, "previous");
      break;
    case "Home":
      destination = adjacentPanelTreeRowId(rows, node.id, "first");
      break;
    case "End":
      destination = adjacentPanelTreeRowId(rows, node.id, "last");
      break;
    case "ArrowRight":
      if (isExpandable(node) && !expanded.has(node.id)) {
        setExpanded(node, true);
        destination = node.id;
      } else if (isExpandable(node)) {
        destination = firstPanelTreeChildId(rows, node.id) ?? node.id;
      }
      break;
    case "ArrowLeft":
      if (isExpandable(node) && expanded.has(node.id)) {
        setExpanded(node, false);
        destination = node.id;
      } else {
        destination = parentPanelTreeRowId(rows, node.id) ?? node.id;
      }
      break;
    case "Enter":
    case " ":
      if (event.key === " " && typeaheadBuffer !== "") {
        typeahead(event, node);
        event.preventDefault();
        return;
      }
      activate(node);
      destination = node.id;
      break;
    default:
      if (typeahead(event, node)) event.preventDefault();
      return;
  }

  if (!destination) return;
  event.preventDefault();
  void focusRow(destination);
}
</script>

{#snippet renderRow(row: PanelTreeRow<T>)}
  {@const node = row.node}
  {@const expandable = isExpandable(node)}
  {@const open = expandable && expanded.has(node.id)}
  {#if node.kind === "group"}
    {#snippet groupLeading()}
      {#if open}
        {#if showGroupDisclosure}
          <ChevronDown class="size-3" aria-hidden="true" />
        {/if}
        <FolderOpen class="size-3.5" aria-hidden="true" />
      {:else}
        {#if showGroupDisclosure}
          <ChevronRight class="size-3" aria-hidden="true" />
        {/if}
        <Folder class="size-3.5" aria-hidden="true" />
      {/if}
    {/snippet}
    {#snippet renderedGroupActions()}
      {#if groupActions}{@render groupActions(node.path)}{/if}
    {/snippet}
    <PanelRow
      label={node.label}
      title={node.path.join("/")}
      leading={groupLeading}
      actions={groupActions ? renderedGroupActions : undefined}
      menuItems={getGroupMenuItems?.(node.path)}
      dense
      class={horizontalScroll ? "w-max min-w-full" : undefined}
      alwaysShowActions={!overlayActions}
      {overlayActions}
      indent={baseIndent + row.depth}
      role="treeitem"
      tabindex={focusedId === node.id ? 0 : -1}
      contentTabindex={-1}
      ariaExpanded={open}
      ariaLevel={row.depth + 1}
      ariaPosInSet={row.posInSet}
      ariaSetSize={row.setSize}
      dataId={node.id}
      onfocus={() => (focusedId = node.id)}
      onkeydown={(event) => handleKeydown(event, node)}
      onclick={(event) => activateFromPointer(event, node)}
    />
  {:else}
    {#snippet leafLeading()}
      {#if showDisclosure && expandable}
        {#if open}
          <ChevronDown class="size-3" aria-hidden="true" />
        {:else}
          <ChevronRight class="size-3" aria-hidden="true" />
        {/if}
      {:else if hasExpandableItems}
        <span class="size-3" aria-hidden="true"></span>
      {/if}
      {#if itemLeading}{@render itemLeading(node.value)}{/if}
    {/snippet}
    {#snippet leafBadges()}
      {#if itemBadges}{@render itemBadges(node.value)}{/if}
    {/snippet}
    {#snippet editorSnippet()}
      {#if itemEditor}{@render itemEditor(node.value)}{/if}
    {/snippet}
    {#snippet leafActions()}
      {#if itemActions}{@render itemActions(node.value)}{/if}
    {/snippet}
    {#snippet leafLabel()}
      {#if itemLabel}{@render itemLabel(node.value)}{/if}
    {/snippet}
    <PanelRow
      label={node.label}
      labelContent={itemLabel ? leafLabel : undefined}
      title={getItemTitle?.(node.value)}
      selected={getItemSelected?.(node.value) ?? false}
      tone={getItemTone?.(node.value)}
      mono={itemMono}
      leading={itemLeading ||
      (showDisclosure && (expandable || hasExpandableItems))
        ? leafLeading
        : undefined}
      badges={itemBadges ? leafBadges : undefined}
      actions={itemActions ? leafActions : undefined}
      menuItems={getItemMenuItems?.(node.value)}
      dense
      alwaysShowActions={!overlayActions}
      {overlayActions}
      class={horizontalScroll ? "w-max min-w-full" : undefined}
      indent={baseIndent + row.depth}
      role="treeitem"
      tabindex={focusedId === node.id ? 0 : -1}
      contentTabindex={-1}
      ariaExpanded={expandable ? open : undefined}
      ariaLevel={row.depth + 1}
      ariaPosInSet={row.posInSet}
      ariaSetSize={row.setSize}
      dataId={node.id}
      draggable={getItemDraggable?.(node.value) ?? false}
      dimmed={getItemDimmed?.(node.value) ?? false}
      dropTarget={getItemDropTarget?.(node.value) ?? false}
      editor={itemEditor && getItemEditing?.(node.value)
        ? editorSnippet
        : undefined}
      ondragstart={(event) => onItemDragStart?.(event, node.value)}
      ondragend={(event) => onItemDragEnd?.(event, node.value)}
      ondragenter={(event) => onItemDragEnter?.(event, node.value)}
      ondragover={(event) => onItemDragOver?.(event, node.value)}
      ondragleave={(event) => onItemDragLeave?.(event, node.value)}
      ondrop={(event) => onItemDrop?.(event, node.value)}
      onfocus={() => (focusedId = node.id)}
      onkeydown={(event) => handleKeydown(event, node)}
      onclick={(event) => activateFromPointer(event, node)}
    />
  {/if}
{/snippet}

<div
  bind:this={root}
  role="tree"
  aria-label={ariaLabel}
  aria-multiselectable={multiselectable || undefined}
  class={cn(
    "flex min-w-0 flex-col",
    // PanelView insets content by one step. The virtualized scroller bleeds
    // back to the panel edge so its scrollbar sits flush, and re-pads its rows.
    virtualized && "-mx-2 min-h-0 flex-1",
    className,
  )}
>
  {#if virtualized}
    <VirtualScroller
      items={rows}
      getKey={(row) => row.node.id}
      estimateSize={() => 20}
      bind:controller={virtualController}
      viewportClass="h-full px-2"
      {horizontalScroll}
      rowClass={horizontalScroll ? "w-max min-w-full" : undefined}
    >
      {#snippet row({ item })}
        {@render renderRow(item)}
      {/snippet}
    </VirtualScroller>
  {:else}
    {#each rows as row (row.node.id)}
      {@render renderRow(row)}
    {/each}
  {/if}
</div>
