<script lang="ts">
import {
  cn,
  type WithElementRef,
  type WithoutChildren,
} from "@nervekit/ui-kit/utils";
import type { HTMLTextareaAttributes } from "svelte/elements";

let {
  ref = $bindable(null),
  value = $bindable(),
  class: className,
  "data-slot": dataSlot = "textarea",
  ...restProps
}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/30 aria-invalid:border-destructive rounded-md border bg-input-background px-2 py-1 text-xs shadow-xs transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 placeholder:text-muted-foreground flex field-sizing-content min-h-control w-full outline-none disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  bind:value
  {...restProps}></textarea>
