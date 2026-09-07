<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** Primary information. */
  title?: string;
  /** Secondary information, rendered under the title. */
  description?: string;
  class?: string;
  tourId?: string;
  leading?: Snippet;
  /** Status badges or dots shown beside the title. */
  status?: Snippet;
  /** Tertiary information, right-aligned before the actions. */
  meta?: Snippet;
  /** Icon actions; revealed on hover and always shown on focus or touch. */
  actions?: Snippet;
  /**
   * Hover reveal suits secondary row actions (edit, remove). Turn it off when the
   * slot holds controls that report state, such as an enable switch.
   */
  revealActionsOnHover?: boolean;
  /** Replaces the default title/description block. */
  content?: Snippet;
};

let {
  title,
  description,
  class: className,
  tourId,
  leading,
  status,
  meta,
  actions,
  revealActionsOnHover = true,
  content,
}: Props = $props();
</script>

<div
  role="listitem"
  data-tour-id={tourId}
  class={cn(
    "settings-list-item group grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5 transition-colors hover:bg-accent/40",
    className,
  )}
>
  <div class="flex min-w-0 items-center gap-2">
    {#if leading}
      {@render leading()}
    {/if}
    {#if content}
      {@render content()}
    {:else}
      <div class="grid min-w-0 gap-0.5">
        <div class="flex min-w-0 items-center gap-2">
          {#if title}
            <span class="truncate text-sm text-foreground">{title}</span>
          {/if}
          {#if status}
            {@render status()}
          {/if}
        </div>
        {#if description}
          <p class="truncate text-xs text-muted-foreground">
            {description}
          </p>
        {/if}
      </div>
    {/if}
  </div>

  {#if meta || actions}
    <div class="flex flex-none items-center gap-2">
      {#if meta}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          {@render meta()}
        </div>
      {/if}
      {#if actions}
        <div
          class="flex items-center gap-0.5"
          class:settings-list-actions={revealActionsOnHover}
        >
          {@render actions()}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
/* Actions stay out of the way until the row is engaged, but never hide from
 * keyboard users or on devices without hover. */
@media (hover: hover) {
  .settings-list-actions {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .settings-list-item:hover .settings-list-actions,
  .settings-list-item:focus-within .settings-list-actions {
    opacity: 1;
  }
}
</style>
