<script lang="ts">
import { Select as SelectPrimitive } from "bits-ui";
import { cn, type WithoutChild } from "@nervekit/ui-kit/utils";
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

let {
  ref = $bindable(null),
  class: className,
  children,
  ...restProps
}: WithoutChild<SelectPrimitive.TriggerProps> = $props();
</script>

<SelectPrimitive.Trigger
  bind:ref
  data-slot="select-trigger"
  class={cn(
    "border-input data-placeholder:text-muted-foreground hover:bg-hover focus-visible:border-ring focus-visible:ring-focus aria-invalid:ring-destructive-strong aria-invalid:border-destructive gap-1.5 rounded-md border bg-input-background py-1 pr-2 pl-2 text-ui transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 h-control *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*='size-'])]:size-4 flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <ChevronDownIcon class="text-muted-foreground size-4 pointer-events-none" />
</SelectPrimitive.Trigger>
