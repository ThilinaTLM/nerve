<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

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

<section
  class={cn(
    "rounded-lg border border-border/70 bg-card p-4 shadow-xs",
    className,
  )}
>
  {#if title || description || actions}
    <header class="mb-3 flex items-start justify-between gap-4">
      <div class="grid min-w-0 gap-0.5">
        {#if title}
          <h3 class="text-sm font-semibold text-foreground">{title}</h3>
        {/if}
        {#if description}
          <p class="text-xs text-muted-foreground">{description}</p>
        {/if}
      </div>
      {#if actions}
        <div class="flex flex-none flex-wrap items-center gap-2">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}

  <div
    class={cn("grid gap-2", divided && "divide-y divide-border/60", bodyClass)}
  >
    {@render children()}
  </div>
</section>
