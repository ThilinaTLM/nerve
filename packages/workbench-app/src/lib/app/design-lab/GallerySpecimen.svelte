<script lang="ts" module>
export type GallerySurface =
  | "well"
  | "panel"
  | "background"
  | "card"
  | "popover";
</script>

<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";
import type { Snippet } from "svelte";

/**
 * One labelled specimen: a component (or a family of states) rendered on a
 * chosen surface so it can be compared in context.
 */
let {
  title,
  description,
  source,
  usage,
  surface = "background",
  layout = "row",
  class: className,
  children,
}: {
  title: string;
  description?: string;
  /** Import path of the component(s) shown, e.g. `ui/button`. */
  source?: string;
  /** Real-app usage, e.g. `120 files · settings, dialogs, shell`. */
  usage?: string;
  surface?: GallerySurface;
  /** `row` wraps items inline; `stack` stacks them; `bare` adds no layout. */
  layout?: "row" | "stack" | "bare";
  class?: string;
  children: Snippet;
} = $props();

const surfaceClass: Record<GallerySurface, string> = {
  well: "bg-well",
  panel: "bg-panel",
  background: "bg-background",
  card: "bg-card text-card-foreground",
  popover: "bg-popover text-popover-foreground",
};
</script>

<article class="flex min-w-0 flex-col gap-2">
  <header class="flex items-start justify-between gap-6">
    <div class="flex min-w-0 flex-col gap-0.5">
      <h3 class="text-sm font-semibold text-foreground">{title}</h3>
      {#if description}
        <p class="text-xs text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if source || usage}
      <div class="flex shrink-0 flex-col items-end gap-0.5">
        {#if source}
          <code class="font-mono text-xs text-muted-foreground">{source}</code>
        {/if}
        {#if usage}
          <span class="text-xs text-muted-foreground">Used in {usage}</span>
        {/if}
      </div>
    {/if}
  </header>
  <div
    data-gallery-surface={surface}
    class={cn(
      "min-w-0 rounded-lg border p-4",
      surfaceClass[surface],
      layout === "row" && "flex flex-wrap items-center gap-3",
      layout === "stack" && "flex flex-col gap-3",
      className,
    )}
  >
    {@render children()}
  </div>
</article>
