<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** Primary information. */
  title?: string;
  /** Secondary information, inline after the title. Keep it short. */
  detail?: Snippet;
  /** Supporting information on its own line under the title. */
  description?: string;
  class?: string;
  tourId?: string;
  leading?: Snippet;
  /** Status badges or dots shown beside the title. */
  status?: Snippet;
  /** Icon actions. The right column holds nothing else. */
  actions?: Snippet;
  /** Replaces the default title block. */
  content?: Snippet;
};

let {
  title,
  detail,
  description,
  class: className,
  tourId,
  leading,
  status,
  actions,
  content,
}: Props = $props();
</script>

<div
  role="listitem"
  data-tour-id={tourId}
  class={cn(
    "grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5 transition-colors hover:bg-accent/40",
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
        <div class="flex min-w-0 items-baseline gap-1.5">
          {#if title}
            <span class="truncate text-sm text-foreground">{title}</span>
          {/if}
          {#if detail}
            <span
              class="flex min-w-0 items-baseline gap-1 truncate text-xs text-muted-foreground"
            >
              {@render detail()}
            </span>
          {/if}
          {#if status}
            <span class="flex flex-none items-center gap-1.5 self-center">
              {@render status()}
            </span>
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

  {#if actions}
    <div class="flex flex-none items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
