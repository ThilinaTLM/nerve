<script lang="ts">
import type { Snippet } from "svelte";
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import { cn } from "@nervekit/ui-kit/utils";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  title,
  meta,
  actions,
  onBack,
  class: className,
}: {
  title: string;
  /** Muted trailing text or status (e.g. "4/7", "Updated 11:20 PM"). */
  meta?: string;
  /** Trailing controls: icon actions, or a badge when status needs a tone. */
  actions?: Snippet;
  /** Drill-in views: a leading back action returning to the parent view. */
  onBack?: () => void;
  class?: string;
} = $props();
</script>

<header
  data-sheet-drag-region
  class={cn("flex min-h-8 flex-none items-center gap-3 px-2.5 py-1", className)}
>
  {#if onBack}
    <!-- No tooltip: focus lands here after drilling in, and a tooltip
    would pop over the panel every time. -->
    <Button
      size="icon-sm"
      variant="ghost"
      ariaLabel="Back"
      class="-mr-2 -ml-1.5"
      onclick={onBack}
    >
      <ChevronLeft aria-hidden="true" />
    </Button>
  {/if}
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
