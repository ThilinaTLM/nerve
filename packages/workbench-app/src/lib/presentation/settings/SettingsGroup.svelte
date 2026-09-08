<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import SettingsInfoHint from "./SettingsInfoHint.svelte";

type Props = {
  title?: string;
  /** Detail shown in a tooltip beside the title, never as a paragraph. */
  info?: string;
  divided?: boolean;
  class?: string;
  bodyClass?: string;
  actions?: Snippet;
  children: Snippet;
};

let {
  title,
  info,
  divided = false,
  class: className,
  bodyClass,
  actions,
  children,
}: Props = $props();
</script>

<section class={cn("grid min-w-0 gap-1.5", className)}>
  {#if title || actions}
    <header class="flex items-baseline justify-between gap-3">
      <div class="flex min-w-0 items-center gap-1.5">
        {#if title}
          <h4 class="truncate text-sm font-semibold text-muted-foreground">
            {title}
          </h4>
        {/if}
        {#if info}
          <SettingsInfoHint text={info} label={`About ${title}`} />
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
