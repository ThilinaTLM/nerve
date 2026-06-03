<script lang="ts">
  import type { Snippet } from "svelte";
  import { ScrollArea as ScrollAreaPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  type ScrollType = "hover" | "scroll" | "auto" | "always";
  type Orientation = "vertical" | "horizontal" | "both";

  type Props = {
    children?: Snippet;
    class?: string;
    viewportClass?: string;
    type?: ScrollType;
    orientation?: Orientation;
    scrollHideDelay?: number;
  };

  let {
    children,
    class: className = "",
    viewportClass = "",
    type = "hover",
    orientation = "vertical",
    scrollHideDelay = 500,
  }: Props = $props();
</script>

{#snippet Bar(axis: "vertical" | "horizontal")}
  <ScrollAreaPrimitive.Scrollbar class={cn("scrollbar", axis)} orientation={axis}>
    <ScrollAreaPrimitive.Thumb class="scroll-thumb" />
  </ScrollAreaPrimitive.Scrollbar>
{/snippet}

<ScrollAreaPrimitive.Root class={cn("ui-scroll-area", className)} {type} {scrollHideDelay}>
  <ScrollAreaPrimitive.Viewport class={cn("scroll-viewport", viewportClass)}>
    {@render children?.()}
  </ScrollAreaPrimitive.Viewport>
  {#if orientation === "vertical" || orientation === "both"}
    {@render Bar("vertical")}
  {/if}
  {#if orientation === "horizontal" || orientation === "both"}
    {@render Bar("horizontal")}
  {/if}
  <ScrollAreaPrimitive.Corner class="scroll-corner" />
</ScrollAreaPrimitive.Root>

<style>
  :global(.ui-scroll-area) {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  :global(.scroll-viewport) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: inherit;
  }

  :global(.scrollbar) {
    display: flex;
    touch-action: none;
    user-select: none;
    border-radius: 999px;
    background: transparent;
    padding: 1px;
    transition:
      background 140ms ease,
      width 140ms ease,
      height 140ms ease;
  }

  :global(.scrollbar:hover),
  :global(.scrollbar[data-state="visible"]) {
    background: rgb(255 255 255 / 5%);
  }

  :global(.scrollbar.vertical) {
    width: 0.48rem;
  }

  :global(.scrollbar.horizontal) {
    height: 0.48rem;
  }

  :global(.scroll-thumb) {
    position: relative;
    flex: 1;
    border-radius: 999px;
    background: hsl(var(--border));
  }

  :global(.scroll-thumb:hover) {
    background: hsl(var(--muted-foreground));
  }

  :global(.scroll-corner) {
    background: transparent;
  }
</style>
