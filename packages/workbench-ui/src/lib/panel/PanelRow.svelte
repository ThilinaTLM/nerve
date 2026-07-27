<script lang="ts">
import type { Component, Snippet } from "svelte";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import {
  StatusDot,
  type StatusTone,
} from "@nervekit/ui-kit/components/ui/status-dot";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  icon: Icon,
  status,
  pulse = false,
  label,
  description,
  title,
  mono = false,
  tone = "default",
  indent = 0,
  selected = false,
  active = false,
  disabled = false,
  dense = false,
  alwaysShowActions = false,
  ariaLabel,
  ariaExpanded,
  leading,
  badges,
  actions,
  menuItems,
  class: className,
  onclick,
  ondblclick,
}: {
  icon?: Component;
  /** Leading status dot tone; takes precedence over `icon`. */
  status?: StatusTone;
  pulse?: boolean;
  label: string;
  description?: string;
  title?: string;
  mono?: boolean;
  tone?: "default" | "muted" | "destructive";
  /** Indentation steps for tree-like lists. */
  indent?: number;
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** Uses the compact row rhythm intended for dense file/status lists. */
  dense?: boolean;
  /** Keeps trailing actions visible instead of revealing them on hover. */
  alwaysShowActions?: boolean;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  /** Compact content rendered before the primary label. */
  leading?: Snippet;
  badges?: Snippet;
  actions?: Snippet;
  menuItems?: ContextMenuItem[];
  class?: string;
  onclick?: (event: MouseEvent) => void;
  ondblclick?: (event: MouseEvent) => void;
} = $props();

const toneClass = $derived(
  tone === "destructive"
    ? "text-destructive"
    : tone === "muted"
      ? "text-muted-foreground"
      : "text-foreground",
);
</script>

{#snippet body()}
  <div
    class={cn(
      "panel-row group/panel-row flex min-w-0 items-center text-xs",
      dense ? "h-6 gap-1 pr-1" : "h-7 gap-1.5 pr-1.5",
      selected && "bg-accent text-accent-foreground",
      className,
    )}
    style={indent > 0 ? `--panel-indent:${indent}` : undefined}
    role="listitem"
  >
    <button
      type="button"
      {disabled}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-current={active ? "true" : undefined}
      title={title ?? description ?? label}
      class={cn(
        "flex min-w-0 flex-1 items-center rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
        dense ? "gap-1" : "gap-1.5",
      )}
      {onclick}
      {ondblclick}
    >
      {#if status}
        <StatusDot tone={status} {pulse} class="shrink-0" />
      {:else if Icon}
        <Icon
          class="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
      {#if leading}
        <span class="flex shrink-0 items-center text-xs text-muted-foreground">
          {@render leading()}
        </span>
      {/if}
      <span
        class={cn(
          "truncate",
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
      <div
        class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
      >
        {@render badges()}
      </div>
    {/if}
    {#if actions}
      <div
        class={cn(
          "flex shrink-0 items-center gap-0.5",
          !alwaysShowActions &&
            "panel-hover-actions group-focus-within/panel-row:opacity-100 group-hover/panel-row:opacity-100",
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
