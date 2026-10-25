<script lang="ts">
import type { Snippet } from "svelte";
import { Popover as PopoverPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";
import { animateTriggerWidth as attachTriggerWidthAnimation } from "./animate-trigger-width.js";

type Props = {
  trigger?: Snippet;
  /** Compose a canonical control while preserving the primitive's trigger behavior. */
  triggerChild?: PopoverPrimitive.TriggerProps["child"];
  children?: Snippet;
  open?: boolean;
  ariaLabel?: string;
  triggerTitle?: string;
  triggerAriaKeyShortcuts?: string;
  class?: string;
  triggerClass?: string;
  /** Animate intrinsic trigger width changes, without fixing its resting width. */
  animateTriggerWidth?: boolean;
  /** Panel width preset: sm 16rem, md 20rem, lg 24rem, anchor matches the
   * trigger (at least 20rem). */
  size?: "sm" | "md" | "lg" | "anchor";
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
  trapFocus?: boolean;
  onOpenChange?: (open: boolean) => void;
};

let {
  trigger,
  triggerChild,
  children,
  open = $bindable(false),
  ariaLabel,
  triggerTitle,
  triggerAriaKeyShortcuts,
  class: className = "",
  triggerClass = "",
  animateTriggerWidth = false,
  size = "md",
  side = "bottom",
  align = "end",
  sideOffset = 6,
  collisionPadding = 8,
  trapFocus = true,
  onOpenChange,
}: Props = $props();

let triggerElement = $state<HTMLButtonElement | null>(null);

$effect(() => {
  if (!animateTriggerWidth || !triggerElement) return;
  return attachTriggerWidthAnimation(triggerElement);
});

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}
</script>

<PopoverPrimitive.Root bind:open onOpenChange={handleOpenChange}>
  <PopoverPrimitive.Trigger
    bind:ref={triggerElement}
    class={cn(
      !triggerChild && "popover-trigger",
      triggerClass,
      animateTriggerWidth && "overflow-hidden",
    )}
    aria-label={ariaLabel}
    title={triggerTitle}
    aria-keyshortcuts={triggerAriaKeyShortcuts}
    child={triggerChild}
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
