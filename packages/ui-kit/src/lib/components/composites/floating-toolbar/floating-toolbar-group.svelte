<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { itemIn, itemOut } from "./floating-motion.js";

type Props = {
  /** Accessible name when the group is a meaningful set ("Zoom"). */
  label?: string;
  /**
   * Hidden while the pane is narrower than 28rem. Only for readouts and for
   * actions that are also reachable from the bar's menu.
   */
  collapse?: boolean;
  children: Snippet;
};

let { label, collapse = false, children }: Props = $props();
</script>

<!-- Related controls of a bar. A group draws the divider before itself, so
     authors never place separators and a hidden group leaves no stray rule. -->
<div
  class={cn(
    "flex items-center gap-0.5 empty:hidden in-data-[orientation=vertical]:flex-col",
    "not-first:before:mx-0.5 not-first:before:h-4 not-first:before:w-px not-first:before:bg-border not-first:before:content-['']",
    "in-data-[orientation=vertical]:not-first:before:mx-0 in-data-[orientation=vertical]:not-first:before:my-0.5 in-data-[orientation=vertical]:not-first:before:h-px in-data-[orientation=vertical]:not-first:before:w-4",
    "@max-md:[[data-collapse]:first-child+&]:before:hidden",
    collapse && "@max-md:hidden",
  )}
  role={label ? "group" : undefined}
  aria-label={label}
  data-collapse={collapse || undefined}
  in:itemIn|global
  out:itemOut|global
>
  {@render children()}
</div>
