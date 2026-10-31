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
  labelContent,
  meta,
  ariaLabel,
  description,
  detail,
  detailTone = "neutral",
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
  trailing,
  actions,
  menuItems,
  class: className,
  onclick,
}: {
  label: string;
  /** Segmented title (e.g. search highlights); label remains the plain accessible fallback. */
  labelContent?: Snippet;
  /** Replaces detail and trailing with a single full-width metadata line. */
  meta?: Snippet;
  ariaLabel?: string;
  /** Maximum visible lines for the primary label. */
  labelLines?: 1 | 2;
  description?: string;
  /** Second line under a two-line label, coloured by `detailTone`. */
  detail?: string;
  detailTone?: StatusTone;
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
  /**
   * Two-line rows only: facts aligned with the first label line. On
   * hover-capable pointers they give way to `actions` while the row is hovered
   * or keyboard-focused.
   */
  trailing?: Snippet;
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
    ? "line-clamp-2 min-w-0 break-words whitespace-normal leading-4"
    : "truncate",
);

function toneTextClass(tone: StatusTone): string {
  return tone === "destructive"
    ? "text-destructive"
    : tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "info"
          ? "text-info"
          : tone === "neutral"
            ? "text-muted-foreground"
            : "text-foreground";
}

const toneClass = $derived(toneTextClass(tone));
const twoLine = $derived(labelLines === 2);
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
      actions && overlayActions && !twoLine && "relative",
      twoLine
        ? "items-start gap-1.5 py-1 pr-0 text-xs"
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
      aria-label={ariaLabel}
      title={title ?? description ?? label}
      class={cn(
        "flex min-w-0 flex-1 cursor-pointer items-center rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50",
        twoLine ? "items-start gap-1" : dense ? "gap-1" : "gap-1.5",
      )}
      {onclick}
    >
      {#if leading}
        <span
          class={cn(
            "flex shrink-0 items-center text-muted-foreground",
            twoLine && "h-4",
          )}
        >
          {@render leading()}
        </span>
      {/if}
      {#if twoLine}
        <span
          class={cn("flex min-w-0 flex-1 flex-col", meta ? "gap-1" : "gap-0.5")}
        >
          <span class={cn(labelLayoutClass, toneClass, active && "font-medium")}
            >{#if labelContent}{@render labelContent()}{:else}{label}{/if}</span
          >
          {#if meta}
            {@render meta()}
          {:else if detail}
            <span class={cn("truncate leading-4", toneTextClass(detailTone))}
              >{detail}</span
            >
          {/if}
        </span>
      {:else}
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
      {/if}
    </button>
    {#if badges}
      <div class="flex shrink-0 items-center gap-1 text-muted-foreground">
        {@render badges()}
      </div>
    {/if}
    {#if twoLine && (trailing || actions)}
      <!-- Facts and actions stack in one grid cell, so the column is as wide as
           the wider of the two and the label never reflows or gets covered. -->
      <div class="grid shrink-0 items-center justify-items-end">
        {#if trailing && !meta}
          <span
            class={cn(
              "col-start-1 row-start-1 flex h-4 items-center gap-1.5 text-muted-foreground tabular-nums",
              actions &&
                "pointer-fine:group-hover/panel-row:invisible pointer-fine:group-has-[:focus-visible]/panel-row:invisible",
            )}
          >
            {@render trailing()}
          </span>
        {/if}
        {#if actions}
          <div
            class="invisible col-start-1 row-start-1 flex items-center gap-0.5 group-hover/panel-row:visible group-has-[:focus-visible]/panel-row:visible pointer-coarse:hidden"
          >
            {@render actions()}
          </div>
        {/if}
      </div>
    {:else if actions}
      <div
        class={cn(
          "flex shrink-0 items-center gap-0.5",
          !alwaysShowActions &&
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
