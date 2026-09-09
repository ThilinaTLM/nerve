<script lang="ts">
import type { Snippet } from "svelte";
import { Popover as PopoverPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  trigger?: Snippet;
  children?: Snippet;
  open?: boolean;
  ariaLabel?: string;
  triggerTitle?: string;
  triggerAriaKeyShortcuts?: string;
  class?: string;
  triggerClass?: string;
  /** Panel width preset: sm 16rem, md 20rem, lg 24rem. */
  size?: "sm" | "md" | "lg";
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
  triggerTitle,
  triggerAriaKeyShortcuts,
  class: className = "",
  triggerClass = "",
  size = "md",
  side = "bottom",
  align = "end",
  sideOffset = 6,
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
  <PopoverPrimitive.Trigger
    class={cn("popover-trigger", triggerClass)}
    aria-label={ariaLabel}
    title={triggerTitle}
    aria-keyshortcuts={triggerAriaKeyShortcuts}
  >
    {@render trigger?.()}
  </PopoverPrimitive.Trigger>
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      class={cn(
        "floating-surface popover-content",
        `popover-${size}`,
        className,
      )}
      {side}
      {align}
      {sideOffset}
      {collisionPadding}
      {trapFocus}
    >
      {@render children?.()}
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
</PopoverPrimitive.Root>
