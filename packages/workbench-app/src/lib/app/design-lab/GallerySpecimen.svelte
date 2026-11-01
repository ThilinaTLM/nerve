<script lang="ts" module>
export type GallerySurface =
  | "well"
  | "panel"
  | "background"
  | "card"
  | "popover";
</script>

<script lang="ts">
import { colorThemeKind, colorThemeSchema } from "@nervekit/contracts/settings";
import LayoutGridIcon from "@lucide/svelte/icons/layout-grid";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import type { Snippet } from "svelte";

/** Every theme the app ships; derived so new themes appear without edits. */
const COMPARE_THEMES = colorThemeSchema.options;

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

let compare = $state(false);

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
      <h3 class="text-ui font-medium text-foreground">{title}</h3>
      {#if description}
        <p class="text-ui text-muted-foreground">{description}</p>
      {/if}
    </div>
    <div class="flex shrink-0 items-start gap-3">
      {#if source || usage}
        <div class="flex flex-col items-end gap-0.5">
          {#if source}
            <code class="font-mono text-ui text-muted-foreground">{source}</code
            >
          {/if}
          {#if usage}
            <span class="text-ui text-muted-foreground">Used in {usage}</span>
          {/if}
        </div>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={compare}
        data-active={compare ? "" : undefined}
        onclick={() => (compare = !compare)}
      >
        <LayoutGridIcon data-icon="inline-start" />
        Compare
      </Button>
    </div>
  </header>
  {#if compare}
    <div
      data-gallery-compare
      class="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,28rem),1fr))]"
    >
      {#each COMPARE_THEMES as theme (theme)}
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-ui text-muted-foreground"
            >{theme} · {colorThemeKind[theme]}</span
          >
          <div
            data-theme-preview={theme}
            data-color-mode={colorThemeKind[theme]}
            class={cn(
              "min-w-0 rounded-lg border bg-background p-4 text-foreground",
              layout === "row" && "flex flex-wrap items-center gap-3",
              layout === "stack" && "flex flex-col gap-3",
              className,
            )}
          >
            {@render children()}
          </div>
        </div>
      {/each}
    </div>
  {:else}
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
  {/if}
</article>
