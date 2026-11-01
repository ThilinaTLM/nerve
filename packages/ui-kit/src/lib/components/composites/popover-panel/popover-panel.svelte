<script lang="ts">
import { untrack, type Snippet } from "svelte";
import {
  Dialog as DialogPrimitive,
  Popover as PopoverPrimitive,
} from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";
import SheetContent from "../../ui/sheet/sheet-content.svelte";
import { phoneViewport, setPopoverPresentation } from "./presentation.js";
import {
  createTriggerWidthAnimation,
  type TriggerWidthAnimation,
} from "./animate-trigger-width.js";

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
  /** Opt in to animating the trigger width, keyed by what the trigger shows.
   * The width animates only when the key changes between two non-null values
   * during or right after the user interacts with this popover; pass `null`
   * while the content is still loading.
   * The resting width stays intrinsic. */
  triggerWidthKey?: string | null;
  /** Panel width preset: sm 16rem, md 20rem, lg 24rem, anchor matches the
   * trigger. Field variants are at least as wide as their trigger and use the
   * preset as their minimum width (anchor and md: 20rem). */
  size?: "sm" | "md" | "lg" | "anchor";
  /** Maximum height preset: default 32rem; tall 44rem for feeds whose length
   * grows with activity (e.g. notifications). Both yield to the viewport. */
  height?: "default" | "tall";
  /** Fields match their trigger; panels have a fixed width and an anchor arrow. */
  variant?: "panel" | "field";
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
  trapFocus?: boolean;
  /** `adaptive` opens a bottom sheet instead on phone-sized viewports, so
   * touch users get full-width rows and a pull-down to dismiss. */
  presentation?: "popover" | "adaptive";
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
  triggerWidthKey,
  size = "md",
  height = "default",
  variant = "panel",
  side = "bottom",
  align,
  sideOffset = 6,
  collisionPadding = 8,
  trapFocus = true,
  presentation = "popover",
  onOpenChange,
}: Props = $props();

const asSheet = $derived(presentation === "adaptive" && phoneViewport());
setPopoverPresentation(() => (asSheet ? "sheet" : "popover"));
let sheetElement = $state<HTMLElement | null>(null);

let triggerElement = $state<HTMLButtonElement | null>(null);
let returnFocusToTrigger = false;

const animatesWidth = $derived(triggerWidthKey !== undefined);
let widthAnimation: TriggerWidthAnimation | undefined;
let settledWidthKey: string | null | undefined;

$effect(() => {
  if (!animatesWidth || !triggerElement) return;
  widthAnimation = createTriggerWidthAnimation(triggerElement);
  return () => {
    widthAnimation?.destroy();
    widthAnimation = undefined;
  };
});

// A width change counts as the user's own only while this popover is open or
// was just closed (choosing an option closes it). Hydration, other pickers'
// side effects and conversation switches therefore never animate.
const INTERACTION_WINDOW_MS = 1500;
let interactedAt = Number.NEGATIVE_INFINITY;
let capturedForChange = false;

let openObserved = false;
$effect(() => {
  void open;
  untrack(() => {
    // The initial run is mount, not an interaction.
    if (openObserved) interactedAt = performance.now();
    openObserved = true;
  });
});

function userChange(key: string | null | undefined): boolean {
  return (
    key != null &&
    settledWidthKey != null &&
    key !== settledWidthKey &&
    (open || performance.now() - interactedAt < INTERACTION_WINDOW_MS)
  );
}

// Runs before the DOM updates: record the width currently on screen.
$effect.pre(() => {
  const key = triggerWidthKey;
  untrack(() => {
    capturedForChange = userChange(key);
    if (capturedForChange) widthAnimation?.capture();
  });
});

$effect(() => {
  const key = triggerWidthKey;
  untrack(() => {
    if (capturedForChange) {
      widthAnimation?.play();
      // One animation per interaction: later async updates stay still.
      interactedAt = Number.NEGATIVE_INFINITY;
    }
    capturedForChange = false;
    settledWidthKey = key;
  });
});

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}
</script>

{#if asSheet}
  <DialogPrimitive.Root bind:open onOpenChange={handleOpenChange}>
    <DialogPrimitive.Trigger
      bind:ref={triggerElement}
      data-popover-variant={variant}
      data-popover-trigger
      class={cn(
        !triggerChild && "popover-trigger",
        triggerClass,
        animatesWidth && "overflow-hidden",
      )}
      aria-label={ariaLabel}
      title={triggerTitle}
      aria-keyshortcuts={triggerAriaKeyShortcuts}
      child={triggerChild}
    >
      {@render trigger?.()}
    </DialogPrimitive.Trigger>
    <SheetContent
      bind:ref={sheetElement}
      side="bottom"
      swipeToDismiss
      onSwipeDismiss={() => handleOpenChange(false)}
      aria-label={ariaLabel}
      class={cn(
        "max-h-[85dvh] rounded-t-xl bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground",
        className,
      )}
      onOpenAutoFocus={(event) => {
        // Focus the sheet itself: a focused field would raise the keyboard.
        event.preventDefault();
        sheetElement?.focus();
      }}
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {@render children?.()}
      </div>
    </SheetContent>
  </DialogPrimitive.Root>
{:else}
  <PopoverPrimitive.Root bind:open onOpenChange={handleOpenChange}>
    <PopoverPrimitive.Trigger
      bind:ref={triggerElement}
      data-popover-variant={variant}
      class={cn(
        !triggerChild && "popover-trigger",
        triggerClass,
        animatesWidth && "overflow-hidden",
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
          variant === "field"
            ? `popover-anchor popover-field-${size === "anchor" ? "md" : size}`
            : `popover-${size}`,
          height === "tall" && "popover-tall",
          className,
        )}
        {side}
        align={align ?? (variant === "field" ? "start" : "end")}
        data-popover-variant={variant}
        {sideOffset}
        {collisionPadding}
        {trapFocus}
        onEscapeKeydown={() => {
          returnFocusToTrigger = true;
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusToTrigger) return;
          returnFocusToTrigger = false;
          event.preventDefault();
          triggerElement?.focus();
        }}
      >
        <div
          class="flex min-h-0 max-h-[inherit] flex-col overflow-hidden rounded-[inherit]"
        >
          {@render children?.()}
        </div>
        {#if variant === "panel"}
          <PopoverPrimitive.Arrow
            class="text-popover stroke-border"
            width={16}
            height={8}
          />
        {/if}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
{/if}
