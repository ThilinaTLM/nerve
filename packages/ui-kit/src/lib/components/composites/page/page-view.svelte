<script lang="ts">
import type { Snippet } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/utils";

let {
  width = "default",
  class: className,
  children,
}: {
  /** Content column: `default` caps it at 46rem like Nerve's settings pages; `wide` at 72rem; `full` uses the whole width. */
  width?: "default" | "wide" | "full";
  class?: string;
  /** Usually a `PageHeader` followed by `PageSection`s. */
  children: Snippet;
} = $props();
</script>

<!-- Root of a tab page: fills its pane, owns the one scroll region and names the
     `page` container the page rows lay out against. -->
<div
  class={cn(
    "@container/page h-full min-h-0 min-w-0 bg-background text-foreground",
    className,
  )}
>
  <ScrollArea class="h-full min-h-0" viewportClass="px-6 pt-6 pb-16">
    <div
      class={cn(
        "mx-auto grid min-w-0 content-start gap-6",
        width === "default" && "w-[min(100%,46rem)]",
        width === "wide" && "w-[min(100%,72rem)]",
        width === "full" && "w-full",
      )}
    >
      {@render children()}
    </div>
  </ScrollArea>
</div>
