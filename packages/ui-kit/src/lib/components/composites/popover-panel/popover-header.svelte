<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  title,
  meta,
  actions,
  class: className,
}: {
  title: string;
  /** Muted trailing text or status (e.g. "4/7", "Updated 11:20 PM"). */
  meta?: string;
  /** Trailing controls: icon actions, or a badge when status needs a tone. */
  actions?: Snippet;
  class?: string;
} = $props();
</script>

<header
  class={cn("flex min-h-8 flex-none items-center gap-3 px-2.5 py-1", className)}
>
  <h2 class="min-w-0 truncate text-sm font-semibold">{title}</h2>
  {#if meta}
    <span class="ml-auto flex-none text-xs text-muted-foreground">{meta}</span>
  {/if}
  {#if actions}
    <div class={cn("flex flex-none items-center gap-0.5", !meta && "ml-auto")}>
      {@render actions()}
    </div>
  {/if}
</header>
