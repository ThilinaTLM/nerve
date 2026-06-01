<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    content: string;
    class?: string;
    side?: "top" | "right" | "bottom" | "left";
    disabled?: boolean;
  };

  let { children, content, class: className = "", side = "top", disabled = false }: Props = $props();
</script>

<TooltipPrimitive.Provider delayDuration={350}>
  <TooltipPrimitive.Root {disabled}>
    <TooltipPrimitive.Trigger class={cn("tooltip-trigger", className)}>
      {@render children?.()}
    </TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content class="tooltip-content" {side} sideOffset={6} collisionPadding={8}>
        {content}
        <TooltipPrimitive.Arrow class="tooltip-arrow" width={8} height={4} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>

<style>
  :global(.tooltip-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
  }

  :global(.tooltip-content) {
    z-index: 80;
    max-width: 18rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-raised);
    color: var(--color-text);
    box-shadow: var(--shadow-popover);
    padding: 0.28rem 0.45rem;
    font-size: 0.7rem;
    line-height: 1.35;
  }

  :global(.tooltip-arrow) {
    fill: var(--color-panel-raised);
  }
</style>
