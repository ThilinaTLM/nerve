<!--
@component
The bar of a `FloatingLayer` anchor; it positions nothing itself. Holds `FloatingToolbarGroup`, `FloatingToolbarButton` and `FloatingToolbarText`. `orientation` `vertical` is for icon-only buttons (zoom in `bottomEnd`); `reveal` `hover` keeps the bar quiet until the pane is hovered or focused.
-->

<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { autoSize, floatIn, floatOut } from "./floating-motion.js";

type Props = {
  /** Accessible name, e.g. "Image controls". */
  label: string;
  /** Vertical bars are icon-only (spatial controls in the bottom-end anchor). */
  orientation?: "horizontal" | "vertical";
  /** `hover`: quiet until the pane (a `group/pane` ancestor) is hovered or a control has focus. */
  reveal?: "always" | "hover";
  class?: string;
  children: Snippet;
};

let {
  label,
  orientation = "horizontal",
  reveal = "always",
  class: className,
  children,
}: Props = $props();

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

// One tab stop per bar: arrow keys, Home and End move between its controls.
function onkeydown(event: KeyboardEvent): void {
  const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const previous = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (![next, previous, "Home", "End"].includes(event.key)) return;
  if (event.target instanceof HTMLInputElement) return;
  const items = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      FOCUSABLE,
    ),
  ];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === next ? 1 : -1;
  const target =
    event.key === "Home"
      ? items[0]
      : event.key === "End"
        ? items.at(-1)
        : items[(index + step + items.length) % items.length];
  event.preventDefault();
  target?.focus();
}
</script>

<!-- A bar of controls floating over a pane; a `FloatingLayer` anchor places
     it. One density: 24px controls on a 2px inset. Pointer and wheel input on
     the bar never reach the pannable content underneath. -->
<div
  class={cn(
    "floating-surface pointer-events-auto max-w-full overflow-clip [overflow-clip-margin:4px]",
    reveal === "hover" &&
      "opacity-60 transition-opacity duration-150 group-hover/pane:opacity-100 focus-within:opacity-100 hover:opacity-100",
    className,
  )}
  role="toolbar"
  aria-label={label}
  aria-orientation={orientation}
  data-orientation={orientation}
  data-slot="floating-toolbar"
  tabindex="-1"
  {onkeydown}
  onpointerdown={(event) => event.stopPropagation()}
  onwheel={(event) => event.stopPropagation()}
  {@attach autoSize()}
  in:floatIn|global
  out:floatOut|global
>
  <div
    class={cn(
      "flex w-max items-center gap-0.5 p-0.5",
      orientation === "vertical" && "flex-col",
    )}
  >
    {@render children()}
  </div>
</div>
