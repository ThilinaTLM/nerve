<!--
@component
Titled card inside a panel.
-->

<script lang="ts">
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { tick, type Component, type Snippet } from "svelte";
import { ItemSurface } from "@nervekit/ui-kit/components/composites/item-surface";

let {
  title,
  icon: Icon,
  titleHint,
  onTitleDblClick,
  titleEditing = false,
  titleMaxLength,
  titleLabel,
  onTitleCommit,
  onTitleCancel,
  titleActions,
  meta,
  actions,
  class: className,
  children,
}: {
  /** Card title. */
  title: string;
  /** Icon component before the title. */
  icon?: Component;
  /** Tooltip for the title control. */
  titleHint?: string;
  /** Called when the title is double-clicked (to start renaming). */
  onTitleDblClick?: () => void;
  /** Swaps the title for an inline editor. */
  titleEditing?: boolean;
  /** Longest title the inline editor accepts. */
  titleMaxLength?: number;
  /** Accessible name of the inline title editor. */
  titleLabel?: string;
  /** Called with the new title when the inline editor is confirmed. */
  onTitleCommit?: (title: string) => void;
  /** Called when the inline editor is dismissed. */
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

<ItemSurface
  element="section"
  focusWithin
  class={`flex-col ${className ?? ""}`}
>
  <div class="flex h-7 min-w-0 items-center gap-1 px-3">
    {#if Icon}
      <Icon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    {/if}
    {#if titleEditing}
      <Input
        bind:ref={titleInput}
        type="text"
        value={title}
        maxlength={titleMaxLength}
        aria-label={titleLabel}
        class="min-w-0 flex-1 font-normal shadow-none"
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
          class="min-w-0 max-w-full truncate rounded-sm text-left text-ui font-normal text-foreground focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none"
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
      <div class="shrink-0 truncate text-ui text-muted-foreground">
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
</ItemSurface>
