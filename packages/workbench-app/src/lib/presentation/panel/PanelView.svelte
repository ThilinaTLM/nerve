<script lang="ts">
import type { Snippet } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  toolbar,
  banner,
  scroll = true,
  padded = true,
  contentClass,
  children,
}: {
  /** Sticky one-line toolbar rendered above the scroll region. */
  toolbar?: Snippet;
  /** Pinned strip between the toolbar and the scroll region. */
  banner?: Snippet;
  /** Set false when the view owns its own scrolling (e.g. a split pane). */
  scroll?: boolean;
  padded?: boolean;
  contentClass?: string;
  children: Snippet;
} = $props();
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col bg-card px-2">
  {#if toolbar}
    {@render toolbar()}
  {/if}
  {#if banner}
    <div class="shrink-0">
      {@render banner()}
    </div>
  {/if}
  {#if scroll}
    <ScrollArea
      class="min-h-0 flex-1"
      viewportClass="grid grid-cols-[minmax(0,1fr)] content-start"
    >
      <div class={cn("flex flex-col", padded && "py-1", contentClass)}>
        {@render children()}
      </div>
    </ScrollArea>
  {:else}
    <div class={cn("flex min-h-0 flex-1 flex-col", contentClass)}>
      {@render children()}
    </div>
  {/if}
</div>
