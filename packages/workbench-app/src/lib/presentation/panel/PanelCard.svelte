<script lang="ts">
import { tick, type Component, type Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  title,
  icon: Icon,
  titleHint,
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
  /** Tooltip for the title control. */
  titleHint?: string;
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
  <div class="flex h-7 min-w-0 items-center gap-1 px-3">
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
        class="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-xs font-normal text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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
      <div class="group/title flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          class="min-w-0 max-w-full truncate rounded-sm text-left text-xs font-normal text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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
      </div>
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
  <div class="min-w-0">
    {@render children()}
  </div>
</section>
