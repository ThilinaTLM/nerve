<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  title: string;
  description?: string;
  class?: string;
  actions?: Snippet;
  /** Rendered under the title row (the tab bar lives here). */
  below?: Snippet;
};

let { title, description, class: className, actions, below }: Props = $props();
</script>

<header class={cn("grid min-w-0 gap-1", className)}>
  <div class="flex min-w-0 items-start justify-between gap-4">
    <div class="grid min-w-0 gap-0.5">
      <h2 class="text-base font-semibold text-foreground">{title}</h2>
      {#if description}
        <p class="text-xs text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex flex-none flex-wrap items-center justify-end gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>
  {#if below}
    {@render below()}
  {/if}
</header>
