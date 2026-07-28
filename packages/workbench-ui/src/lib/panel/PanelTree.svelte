<script lang="ts" generics="T">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import { cn } from "@nervekit/ui-kit/core/utils";
import { tick, type Snippet } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import PanelRow from "./PanelRow.svelte";
import {
  adjacentPanelTreeRowId,
  expandedPanelTreeIds,
  firstPanelTreeChildId,
  panelTreeExpandableIds,
  parentPanelTreeRowId,
  visiblePanelTreeRows,
  type PanelTreeNode,
} from "./panel-tree.js";

type Props = {
  /** Prebuilt nodes from `buildPanelTree` (paths) or `buildPanelItemTree`. */
  nodes: readonly PanelTreeNode<T>[];
  ariaLabel: string;
  /** Indentation steps applied to root rows, for trees nested under a header. */
  baseIndent?: number;
  getItemTitle?: (item: T) => string;
  getItemDescription?: (item: T) => string | undefined;
  /** Third line for stacked item rows. */
  getItemMeta?: (item: T) => string | undefined;
  itemMetaMono?: boolean;
  /**
   * `card` renders each root item and its expanded descendants as one grouped
   * surface, divided like the pull-request check list.
   */
  itemVariant?: "row" | "card";
  /** Extra classes for item rows. */
  itemClass?: string;
  /**
   * Indents nested item rows by depth. Disable when the chevron column alone
   * should carry the hierarchy, e.g. grouped cards.
   */
  indentItems?: boolean;
  getItemSelected?: (item: T) => boolean;
  itemMono?: boolean;
  /** Renders item descriptions on a second line instead of inline. */
  itemStacked?: boolean;
  /**
   * Activates a leaf or item parent. Item parents also toggle their children on
   * the same click, so selecting and disclosing stay a single gesture.
   */
  onItemActivate?: (item: T) => void;
  itemLeading?: Snippet<[T]>;
  /** Inline content after the label of a stacked item row. */
  itemLabelTrailing?: Snippet<[T]>;
  itemBadges?: Snippet<[T]>;
  itemActions?: Snippet<[T]>;
  class?: string;
};

let {
  nodes,
  ariaLabel,
  baseIndent = 0,
  getItemTitle,
  getItemDescription,
  getItemMeta,
  itemMetaMono = false,
  itemVariant = "row",
  itemClass,
  indentItems = true,
  getItemSelected,
  itemMono = false,
  itemStacked = false,
  onItemActivate,
  itemLeading,
  itemLabelTrailing,
  itemBadges,
  itemActions,
  class: className,
}: Props = $props();

let root: HTMLElement | undefined = $state();
const collapsed = new SvelteSet<string>();
let focusedId = $state<string>();

const expandableIds = $derived(panelTreeExpandableIds(nodes));
const expanded = $derived(expandedPanelTreeIds(expandableIds, collapsed));
const rows = $derived(visiblePanelTreeRows(nodes, expanded));
/** Reserve the chevron column so leaf rows align with expandable siblings. */
const hasExpandableItems = $derived(
  rows.some((row) => row.node.kind === "item" && row.node.children.length > 0),
);

/** Card grouping: a root row opens a surface that its descendants continue. */
function cardClass(index: number): string | undefined {
  if (itemVariant !== "card") return undefined;
  const isFirst = rows[index]?.parentId === undefined;
  const next = rows[index + 1];
  const isLast = !next || next.parentId === undefined;
  return cn(
    "bg-accent/35",
    isFirst ? "rounded-t-md" : "rounded-t-none border-t border-border/60",
    isLast ? "rounded-b-md" : "rounded-b-none",
    isFirst && index > 0 && "mt-1.5",
  );
}

$effect(() => {
  for (const id of collapsed) if (!expandableIds.has(id)) collapsed.delete(id);
});

$effect(() => {
  const visibleIds = new Set(rows.map((row) => row.node.id));
  if (!focusedId || !visibleIds.has(focusedId)) focusedId = rows[0]?.node.id;
});

function setExpanded(id: string, open: boolean): void {
  if (open) collapsed.delete(id);
  else collapsed.add(id);
}

function isExpandable(node: PanelTreeNode<T>): boolean {
  return node.children.length > 0;
}

function toggle(node: PanelTreeNode<T>): void {
  if (isExpandable(node)) setExpanded(node.id, !expanded.has(node.id));
}

function activate(node: PanelTreeNode<T>): void {
  if (node.kind === "item") onItemActivate?.(node.value);
  toggle(node);
}

async function focusRow(id: string | undefined): Promise<void> {
  if (!id) return;
  focusedId = id;
  await tick();
  const element = [
    ...(root?.querySelectorAll<HTMLElement>("[data-panel-row-id]") ?? []),
  ].find((candidate) => candidate.dataset.panelRowId === id);
  element?.focus();
}

function activateFromPointer(event: MouseEvent, node: PanelTreeNode<T>): void {
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    "[data-panel-row-id]",
  );
  focusedId = node.id;
  row?.focus();
  activate(node);
}

function handleKeydown(event: KeyboardEvent, node: PanelTreeNode<T>): void {
  if (event.target !== event.currentTarget) return;

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
        setExpanded(node.id, true);
        destination = node.id;
      } else if (isExpandable(node)) {
        destination = firstPanelTreeChildId(rows, node.id) ?? node.id;
      }
      break;
    case "ArrowLeft":
      if (isExpandable(node) && expanded.has(node.id)) {
        setExpanded(node.id, false);
        destination = node.id;
      } else {
        destination = parentPanelTreeRowId(rows, node.id) ?? node.id;
      }
      break;
    case "Enter":
    case " ":
      activate(node);
      destination = node.id;
      break;
    default:
      return;
  }

  if (!destination) return;
  event.preventDefault();
  void focusRow(destination);
}
</script>

<div
  bind:this={root}
  role="tree"
  aria-label={ariaLabel}
  class={cn("flex min-w-0 flex-col", className)}
>
  {#each rows as row, rowIndex (row.node.id)}
    {@const node = row.node}
    {@const expandable = node.children.length > 0}
    {@const open = expandable && expanded.has(node.id)}
    {#if node.kind === "group"}
      {#snippet groupLeading()}
        {#if open}
          <ChevronDown class="size-3" aria-hidden="true" />
          <FolderOpen class="size-3.5" aria-hidden="true" />
        {:else}
          <ChevronRight class="size-3" aria-hidden="true" />
          <Folder class="size-3.5" aria-hidden="true" />
        {/if}
      {/snippet}
      <PanelRow
        label={node.label}
        title={node.path.join("/")}
        leading={groupLeading}
        dense
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
        {#if expandable}
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
      {#snippet leafLabelTrailing()}
        {#if itemLabelTrailing}{@render itemLabelTrailing(node.value)}{/if}
      {/snippet}
      {#snippet leafBadges()}
        {#if itemBadges}{@render itemBadges(node.value)}{/if}
      {/snippet}
      {#snippet leafActions()}
        {#if itemActions}{@render itemActions(node.value)}{/if}
      {/snippet}
      <PanelRow
        label={node.label}
        description={getItemDescription?.(node.value)}
        meta={getItemMeta?.(node.value)}
        metaMono={itemMetaMono}
        title={getItemTitle?.(node.value)}
        selected={getItemSelected?.(node.value) ?? false}
        mono={itemMono}
        stacked={itemStacked}
        leading={itemLeading || expandable || hasExpandableItems
          ? leafLeading
          : undefined}
        labelTrailing={itemLabelTrailing ? leafLabelTrailing : undefined}
        badges={itemBadges ? leafBadges : undefined}
        actions={itemActions ? leafActions : undefined}
        dense
        alwaysShowActions
        class={cn(cardClass(rowIndex), itemClass)}
        indent={baseIndent + (indentItems ? row.depth : 0)}
        role="treeitem"
        tabindex={focusedId === node.id ? 0 : -1}
        contentTabindex={-1}
        ariaExpanded={expandable ? open : undefined}
        ariaLevel={row.depth + 1}
        ariaPosInSet={row.posInSet}
        ariaSetSize={row.setSize}
        dataId={node.id}
        onfocus={() => (focusedId = node.id)}
        onkeydown={(event) => handleKeydown(event, node)}
        onclick={(event) => activateFromPointer(event, node)}
      />
    {/if}
  {/each}
</div>
