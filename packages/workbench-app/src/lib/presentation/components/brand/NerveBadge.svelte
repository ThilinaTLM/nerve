<script lang="ts">
import { cn } from "@nervekit/ui-kit/core/utils";
import NerveMark from "./NerveMark.svelte";

let {
  label,
  class: className,
}: {
  label?: string;
  class?: string;
} = $props();
</script>

<span
  class={cn(
    "nerve-badge inline-flex items-center justify-center rounded-lg bg-foreground text-background",
    className,
  )}
>
  <NerveMark compact {label} />
</span>

<style>
/* Matches the titlebar mark-to-badge ratio in
   $lib/app/shell/Titlebar.svelte (.brand-mark).
   No optical nudge here: the compact mark's ink (stroke included) is already
   centered in its viewBox, so plain flex centering is balanced. The titlebar's
   translate() is a sub-pixel correction for 1rem rendering and visibly skews the
   mark right and down once scaled up. */
.nerve-badge :global(svg) {
  width: 62.5%;
  height: 62.5%;
}
</style>
