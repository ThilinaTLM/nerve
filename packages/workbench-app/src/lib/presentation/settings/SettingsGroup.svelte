<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  title?: string;
  description?: string;
  divided?: boolean;
  class?: string;
  bodyClass?: string;
  actions?: Snippet;
  children: Snippet;
};

let {
  title,
  description,
  divided = false,
  class: className,
  bodyClass,
  actions,
  children,
}: Props = $props();
</script>

<section class={cn("grid min-w-0 gap-1.5", className)}>
  {#if title || description || actions}
    <header class="flex items-baseline justify-between gap-3">
      <div class="grid min-w-0 gap-0.5">
        {#if title}
          <h4 class="text-xs font-semibold text-foreground">{title}</h4>
        {/if}
        {#if description}
          <p class="text-xs text-muted-foreground">{description}</p>
        {/if}
      </div>
      {#if actions}
        <div class="flex flex-none flex-wrap items-center gap-1.5">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}

  <div
    class={cn(
      "grid min-w-0",
      divided ? "divide-y divide-border/40" : "gap-1.5",
      bodyClass,
    )}
  >
    {@render children()}
  </div>
</section>
