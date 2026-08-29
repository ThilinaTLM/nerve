<script lang="ts">
import { cn, type WithElementRef } from "@nervekit/ui-kit/utils";
import type { HTMLAttributes } from "svelte/elements";

let {
  ref = $bindable(null),
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="alert-dialog-footer"
  class={cn("dialog-footer gap-2", className)}
  {...restProps}
>
  {@render children?.()}
</div>
