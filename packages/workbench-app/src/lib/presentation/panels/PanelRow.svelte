<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { Snippet } from "svelte";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import { cn } from "@nervekit/ui-kit/utils";

let {
  label,
  labelLines = 1,
  description,
  title,
  mono = false,
  tone = "neutral",
  indent = 0,
  flush = false,
  selected = false,
  active = false,
  disabled = false,
  dense = false,
  hoverable = true,
  alwaysShowActions = false,
  overlayActions = false,
  ariaExpanded,
  role = "listitem",
  tabindex,
  contentTabindex,
  ariaLevel,
  ariaPosInSet,
  ariaSetSize,
  dataId,
  draggable,
  ondragstart,
  onkeydown,
  onfocus,
  leading,
  badges,
  actions,
  menuItems,
  class: className,
  onclick,
}: {
  label: string;
  /** Maximum visible lines for the primary label. */
  labelLines?: 1 | 2;
  description?: string;
  title?: string;
  mono?: boolean;
  tone?: StatusTone;
  /** Indentation steps for tree-like lists. */
  indent?: number;
  /** Drops the base row inset so the row aligns with the panel's outer padding. */
  flush?: boolean;
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** Uses the compact row rhythm intended for dense file/status lists. */
  dense?: boolean;
  /** Enables the shared row background on pointer hover. */
  hoverable?: boolean;
  /** Keeps trailing actions visible instead of revealing them on hover. */
  alwaysShowActions?: boolean;
  /** Reveals actions over the row so hidden controls reserve no width. */
  overlayActions?: boolean;
  ariaExpanded?: boolean;
  /** Outer row semantics. Tree rows opt into `treeitem`; list rows keep the default. */
  role?: "listitem" | "treeitem" | "none";
  /** Optional roving focus index for semantic row containers. */
  tabindex?: number;
  /** Overrides the primary content button's tab index. */
  contentTabindex?: number;
  ariaLevel?: number;
  ariaPosInSet?: number;
  ariaSetSize?: number;
  /** Stable DOM lookup key for composite widgets such as trees. */
  dataId?: string;
  draggable?: boolean;
  ondragstart?: (event: DragEvent) => void;
  onkeydown?: (event: KeyboardEvent) => void;
  onfocus?: (event: FocusEvent) => void;
  /** Compact content rendered before the primary label. */
  leading?: Snippet;
  badges?: Snippet;
  actions?: Snippet;
  menuItems?: ContextMenuItem[];
  class?: string;
  onclick?: (event: MouseEvent) => void;
} = $props();

const rowStyle = $derived(
  [
    indent > 0 ? `--panel-indent:${indent}` : undefined,
    flush ? "--panel-row-inset:0px" : undefined,
  ]
    .filter(Boolean)
    .join(";") || undefined,
);

const labelLayoutClass = $derived(
  labelLines === 2
    ? "line-clamp-2 break-words whitespace-normal leading-snug"
    : "truncate",
);

const toneClass = $derived(
  tone === "destructive"
    ? "text-destructive"
    : tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "info"
          ? "text-info"
          : tone === "neutral"
            ? "text-muted-foreground"
            : "text-foreground",
);
</script>

{#snippet body()}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class={cn(
      "group/panel-row flex min-w-0 items-center rounded-sm",
      // One indent step per nesting level on top of the base inset; `flush`
      // zeroes the inset via `--panel-row-inset`.
      "pl-[calc(var(--panel-row-inset,0.5rem)+var(--panel-indent,0)*0.75rem)]",
      hoverable && "panel-row-hoverable",
      actions && overlayActions && "relative",
      labelLines === 2
        ? "h-9 gap-2 py-0.5 pr-3 text-xs"
        : dense
          ? "h-5 gap-1 pr-1 text-xs"
          : "h-7 gap-1.5 pr-1.5 text-xs",
      selected && "bg-selected text-foreground",
      tabindex !== undefined &&
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
      className,
    )}
    style={rowStyle}
    {role}
    {tabindex}
    aria-expanded={role === "treeitem" ? ariaExpanded : undefined}
    aria-level={ariaLevel}
    aria-posinset={ariaPosInSet}
    aria-setsize={ariaSetSize}
    data-panel-row-id={dataId}
    {draggable}
    {ondragstart}
    {onkeydown}
    {onfocus}
  >
    <button
      type="button"
      {disabled}
      tabindex={contentTabindex}
      aria-expanded={role === "treeitem" ? undefined : ariaExpanded}
      aria-current={active ? "true" : undefined}
      title={title ?? description ?? label}
      class={cn(
        "flex min-w-0 flex-1 cursor-pointer items-center rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50",
        labelLines === 2 ? "gap-2" : dense ? "gap-1" : "gap-1.5",
      )}
      {onclick}
    >
      {#if leading}
        <span class="flex shrink-0 items-center text-muted-foreground">
          {@render leading()}
        </span>
      {/if}
      <span
        class={cn(
          labelLayoutClass,
          toneClass,
          mono && "font-mono",
          active && "font-medium",
        )}>{label}</span
      >
      {#if description}
        <span class="min-w-0 flex-1 truncate text-muted-foreground"
          >{description}</span
        >
      {/if}
    </button>
    {#if badges}
      <div class="flex shrink-0 items-center gap-1 text-muted-foreground">
        {@render badges()}
      </div>
    {/if}
    {#if actions}
      <div
        class={cn(
          "flex shrink-0 items-center gap-0.5",
          !alwaysShowActions &&
            "opacity-0 transition-opacity duration-120 ease-[ease] group-focus-within/panel-row:opacity-100 group-hover/panel-row:opacity-100 pointer-coarse:opacity-100",
          !alwaysShowActions &&
            overlayActions &&
            "pointer-events-none absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-sm bg-background/95 pl-1 shadow-sm group-focus-within/panel-row:pointer-events-auto group-hover/panel-row:pointer-events-auto",
        )}
      >
        {@render actions()}
      </div>
    {/if}
  </div>
{/snippet}

{#if menuItems && menuItems.length > 0}
  <ContextMenuList items={menuItems} triggerClass="block min-w-0">
    {@render body()}
  </ContextMenuList>
{:else}
  {@render body()}
{/if}
