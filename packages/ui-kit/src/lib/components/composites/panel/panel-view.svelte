<!--
@component
Root of a dock panel: owns the height, the panel surface and padding. Snippets: `banner` (pinned: `PanelHeader`, `PanelFilterBar`, a `Callout layout="strip"`) and `toolbar`; `children` is the content and owns the one scroll region (`ScrollArea`, `PanelTree virtualized`, `PanelSplit`).
-->

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
  /** Classes of the content area. */
  contentClass?: string;
  children: Snippet;
} = $props();
</script>

<!-- The view never scrolls itself; content owns its scroll region. -->
<div class="flex h-full min-h-0 min-w-0 flex-col bg-panel px-2">
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
