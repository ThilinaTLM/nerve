<script lang="ts">
import { cn, type WithElementRef } from "@nervekit/ui-kit/utils";
import type { HTMLAttributes } from "svelte/elements";

let {
  ref = $bindable(null),
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<kbd
  bind:this={ref}
  data-slot="kbd"
  class={cn(
    "bg-muted text-muted-foreground h-5 w-fit min-w-5 gap-1 rounded-sm px-1 font-sans text-caption [&_svg:not([class*='size-'])]:size-3 pointer-events-none inline-flex items-center justify-center select-none",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</kbd>
