<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

/** The panel's only scroll container. Its height is bounded by the panel, so
 * consumers never set their own `max-h-*`. When it holds a navigable list it
 * takes the listbox role; the highlighted row is announced by the search field
 * that has focus, through `aria-activedescendant`. */
let {
  class: className,
  ref = $bindable(null),
  id,
  role,
  ariaLabel,
  children,
}: {
  class?: string;
  ref?: HTMLDivElement | null;
  id?: string;
  role?: "listbox";
  ariaLabel?: string;
  children?: Snippet;
} = $props();
</script>

<div
  bind:this={ref}
  {id}
  {role}
  aria-label={ariaLabel}
  class={cn(
    "grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-2 pb-2 text-xs",
    className,
  )}
>
  {@render children?.()}
</div>
