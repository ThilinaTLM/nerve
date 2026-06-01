<script lang="ts">
  import type { Snippet } from "svelte";
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    trigger?: Snippet;
    children?: Snippet;
    open?: boolean;
    ariaLabel?: string;
    class?: string;
    triggerClass?: string;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    sideOffset?: number;
    collisionPadding?: number;
    trapFocus?: boolean;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    trigger,
    children,
    open = $bindable(false),
    ariaLabel,
    class: className = "",
    triggerClass = "",
    side = "bottom",
    align = "end",
    sideOffset = 7,
    collisionPadding = 8,
    trapFocus = true,
    onOpenChange,
  }: Props = $props();

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<PopoverPrimitive.Root bind:open onOpenChange={handleOpenChange}>
  <PopoverPrimitive.Trigger class={cn("popover-trigger", triggerClass)} aria-label={ariaLabel}>
    {@render trigger?.()}
  </PopoverPrimitive.Trigger>
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content class={cn("popover-content", className)} {side} {align} {sideOffset} {collisionPadding} {trapFocus}>
      {@render children?.()}
      <PopoverPrimitive.Arrow class="popover-arrow" width={9} height={5} />
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
</PopoverPrimitive.Root>

<style>
  :global(.popover-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    cursor: pointer;
  }

  :global(.popover-trigger:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  :global(.popover-content) {
    z-index: 70;
    width: min(24rem, calc(100vw - 1.5rem));
    max-height: min(32rem, var(--bits-popover-content-available-height, 32rem));
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text);
    box-shadow: var(--shadow-popover);
  }

  :global(.popover-content:focus-visible) {
    outline: none;
  }

  :global(.popover-arrow) {
    fill: var(--color-panel);
  }
</style>
