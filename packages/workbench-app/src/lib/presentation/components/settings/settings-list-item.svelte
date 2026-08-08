<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  title?: string;
  description?: string;
  class?: string;
  tourId?: string;
  leading?: Snippet;
  badges?: Snippet;
  meta?: Snippet;
  actions?: Snippet;
  /** Replaces the default title/description block. */
  content?: Snippet;
};

let {
  title,
  description,
  class: className,
  tourId,
  leading,
  badges,
  meta,
  actions,
  content,
}: Props = $props();
</script>

<div
  data-tour-id={tourId}
  class={cn(
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5",
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
          {#if badges}
            {@render badges()}
          {/if}
        </div>
        {#if description}
          <p class="text-xs text-muted-foreground">
            {description}
          </p>
        {/if}
      </div>
    {/if}
  </div>

  {#if meta || actions}
    <div class="flex flex-none items-center gap-2.5">
      {#if meta}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          {@render meta()}
        </div>
      {/if}
      {#if actions}
        <div class="flex items-center gap-1.5">
          {@render actions()}
        </div>
      {/if}
    </div>
  {/if}
</div>
