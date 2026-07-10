<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import { cn, type WithElementRef } from "@nervekit/workbench-ui/core/utils";

let {
  ref = $bindable(null),
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="sheet-header"
  class={cn("flex items-center gap-2 border-b px-3 py-2", className)}
  {...restProps}
>
  {@render children?.()}
</div>
