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
  buildPanelTree,
  expandedPanelTreeGroupIds,
  firstPanelTreeChildId,
  panelTreeGroupIds,
  parentPanelTreeRowId,
  visiblePanelTreeRows,
  type PanelTreeNode,
} from "./panel-tree.js";

type Props = {
  items: readonly T[];
  getPath: (item: T) => readonly string[];
  getKey: (item: T, index: number) => string;
  ariaLabel: string;
  /** Indentation steps applied to root rows, for trees nested under a header. */
  baseIndent?: number;
  getItemTitle?: (item: T) => string;
  getItemDescription?: (item: T) => string | undefined;
  onItemActivate?: (item: T) => void;
  itemLeading?: Snippet<[T]>;
  itemBadges?: Snippet<[T]>;
  itemActions?: Snippet<[T]>;
  class?: string;
};

let {
  items,
  getPath,
  getKey,
  ariaLabel,
  baseIndent = 0,
  getItemTitle,
  getItemDescription,
  onItemActivate,
  itemLeading,
  itemBadges,
  itemActions,
  class: className,
}: Props = $props();

let root: HTMLElement | undefined = $state();
const collapsed = new SvelteSet<string>();
let focusedId = $state<string>();

const nodes = $derived(buildPanelTree(items, { getPath, getKey }));
const groupIds = $derived(panelTreeGroupIds(nodes));
const expanded = $derived(expandedPanelTreeGroupIds(groupIds, collapsed));
const rows = $derived(visiblePanelTreeRows(nodes, expanded));

$effect(() => {
  for (const id of collapsed) if (!groupIds.has(id)) collapsed.delete(id);
});

$effect(() => {
  const visibleIds = new Set(rows.map((row) => row.node.id));
  if (!focusedId || !visibleIds.has(focusedId)) focusedId = rows[0]?.node.id;
});

function setExpanded(id: string, open: boolean): void {
  if (open) collapsed.delete(id);
  else collapsed.add(id);
}

function toggle(node: PanelTreeNode<T>): void {
  if (node.kind === "group") setExpanded(node.id, !expanded.has(node.id));
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
  if (node.kind === "group") toggle(node);
  else onItemActivate?.(node.value);
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
      if (node.kind === "group" && !expanded.has(node.id)) {
        setExpanded(node.id, true);
        destination = node.id;
      } else if (node.kind === "group") {
        destination = firstPanelTreeChildId(rows, node.id) ?? node.id;
      }
      break;
    case "ArrowLeft":
      if (node.kind === "group" && expanded.has(node.id)) {
        setExpanded(node.id, false);
        destination = node.id;
      } else {
        destination = parentPanelTreeRowId(rows, node.id) ?? node.id;
      }
      break;
    case "Enter":
    case " ":
      if (node.kind === "group") toggle(node);
      else onItemActivate?.(node.value);
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
  {#each rows as row (row.node.id)}
    {@const node = row.node}
    {@const open = node.kind === "group" && expanded.has(node.id)}
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
        {#if itemLeading}{@render itemLeading(node.value)}{/if}
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
        title={getItemTitle?.(node.value)}
        leading={itemLeading ? leafLeading : undefined}
        badges={itemBadges ? leafBadges : undefined}
        actions={itemActions ? leafActions : undefined}
        dense
        alwaysShowActions
        indent={baseIndent + row.depth}
        role="treeitem"
        tabindex={focusedId === node.id ? 0 : -1}
        contentTabindex={-1}
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
