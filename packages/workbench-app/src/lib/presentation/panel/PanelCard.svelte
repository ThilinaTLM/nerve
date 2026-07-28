<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { tick, type Component, type Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import PanelToolbarButton from "./PanelToolbarButton.svelte";

let {
  title,
  icon: Icon,
  collapsed = false,
  titleHint,
  onToggleCollapsed,
  onTitleDblClick,
  titleEditing = false,
  titleMaxLength,
  onTitleCommit,
  onTitleCancel,
  titleActions,
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
  /** Swaps the title for an inline editor. */
  titleEditing?: boolean;
  titleMaxLength?: number;
  onTitleCommit?: (title: string) => void;
  onTitleCancel?: () => void;
  /** Icon actions rendered inline after the title. */
  titleActions?: Snippet;
  /** Right-aligned muted status text. */
  meta?: Snippet;
  /** Always-visible icon actions. */
  actions?: Snippet;
  class?: string;
  children: Snippet;
} = $props();

let titleInput: HTMLInputElement | undefined = $state();
let committed = false;

$effect(() => {
  if (!titleEditing) return;
  committed = false;
  void tick().then(() => {
    titleInput?.focus();
    titleInput?.select();
  });
});

function commit(value: string): void {
  if (committed) return;
  committed = true;
  const trimmed = value.trim();
  if (trimmed && trimmed !== title) onTitleCommit?.(trimmed);
  else onTitleCancel?.();
}

function cancel(): void {
  if (committed) return;
  committed = true;
  onTitleCancel?.();
}
</script>

<section
  class={cn(
    "flex min-w-0 flex-col rounded-md bg-accent/35 transition-colors focus-within:bg-accent/60",
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
    {#if titleEditing}
      <input
        bind:this={titleInput}
        type="text"
        value={title}
        maxlength={titleMaxLength}
        aria-label="Note title"
        class="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-xs font-medium text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onblur={(event) => commit(event.currentTarget.value)}
      />
    {:else}
      <button
        type="button"
        class="min-w-0 max-w-full truncate rounded-sm text-left text-xs font-medium text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        title={titleHint ?? title}
        ondblclick={() => onTitleDblClick?.()}
      >
        {title}
      </button>
      {#if titleActions}
        <div class="flex shrink-0 items-center gap-0.5">
          {@render titleActions()}
        </div>
      {/if}
      <div class="flex-1"></div>
    {/if}
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
    <div class="min-w-0 border-t border-border/60">
      {@render children()}
    </div>
  {/if}
</section>
