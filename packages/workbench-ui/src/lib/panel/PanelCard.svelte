<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import type { Component, Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import PanelToolbarButton from "./PanelToolbarButton.svelte";

let {
  title,
  icon: Icon,
  collapsed = false,
  titleHint,
  onToggleCollapsed,
  onTitleDblClick,
  meta,
  actions,
  class: className,
  children,
}: {
  title: string;
  icon?: Component;
  /** Controlled collapse state; the body renders only when expanded. */
  collapsed?: boolean;
  /** Tooltip for the title control. */
  titleHint?: string;
  onToggleCollapsed?: () => void;
  onTitleDblClick?: () => void;
  /** Right-aligned muted status text. */
  meta?: Snippet;
  /** Always-visible icon actions. */
  actions?: Snippet;
  class?: string;
  children: Snippet;
} = $props();
</script>

<section
  class={cn(
    "flex min-w-0 flex-col rounded-md border border-border bg-background focus-within:border-ring",
    className,
  )}
>
  <div class="flex h-7 min-w-0 items-center gap-1 pr-1 pl-0.5">
    <PanelToolbarButton
      icon={collapsed ? ChevronRight : ChevronDown}
      label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
      dense
      onclick={() => onToggleCollapsed?.()}
    />
    {#if Icon}
      <Icon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    {/if}
    <button
      type="button"
      class="min-w-0 flex-1 truncate rounded-sm text-left text-xs font-medium text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      title={titleHint ?? title}
      ondblclick={() => onTitleDblClick?.()}
    >
      {title}
    </button>
    {#if meta}
      <div class="shrink-0 truncate text-xs text-muted-foreground">
        {@render meta()}
      </div>
    {/if}
    {#if actions}
      <div class="flex shrink-0 items-center gap-0.5">
        {@render actions()}
      </div>
    {/if}
  </div>
  {#if !collapsed}
    <div class="min-w-0 border-t border-border">
      {@render children()}
    </div>
  {/if}
</section>
