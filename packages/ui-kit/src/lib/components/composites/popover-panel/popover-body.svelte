<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";

/** The panel's only scroll container. Its height is bounded by the panel, so
 * consumers never set their own `max-h-*`. Overflow is stated by edge shadows
 * rather than a scrollbar. When it holds a navigable list it takes the listbox
 * role; the highlighted row is announced by the search field that has focus,
 * through `aria-activedescendant`. */
let {
  class: className,
  ref = $bindable(),
  id,
  role,
  ariaLabel,
  stableHeight,
  children,
}: {
  /** Layout for the scrolled content (gaps, padding overrides). */
  class?: string;
  ref?: HTMLDivElement;
  id?: string;
  role?: "listbox";
  ariaLabel?: string;
  /** Pins the scroll viewport so a panel whose tabs hold different row counts
   * keeps one height instead of resizing as the user switches. */
  stableHeight?: string;
  children?: Snippet;
} = $props();
</script>

<ScrollRegion
  bind:viewport={ref}
  surface="popover"
  height={stableHeight}
  {id}
  {role}
  {ariaLabel}
  class="text-xs"
  contentClass={cn("grid content-start gap-2 px-2 pb-2", className)}
>
  {@render children?.()}
</ScrollRegion>
