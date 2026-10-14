<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  toolbar,
  banner,
  contentClass,
  children,
}: {
  /** Sticky one-line toolbar rendered above the content. */
  toolbar?: Snippet;
  /** Pinned strip between the toolbar and the content. */
  banner?: Snippet;
  contentClass?: string;
  children: Snippet;
} = $props();
</script>

<!-- The view never scrolls itself; content owns its scroll region. -->
<div class="flex h-full min-h-0 min-w-0 flex-col bg-card px-2">
  {#if toolbar}
    {@render toolbar()}
  {/if}
  {#if banner}
    <div class="shrink-0">
      {@render banner()}
    </div>
  {/if}
  <div class={cn("flex min-h-0 flex-1 flex-col", contentClass)}>
    {@render children()}
  </div>
</div>
