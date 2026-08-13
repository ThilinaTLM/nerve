<script lang="ts">
import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
import { cn, type WithoutChild } from "@nervekit/ui-kit/core/utils";
import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

let {
  ref = $bindable(null),
  class: className,
  inset,
  children,
  ...restProps
}: WithoutChild<ContextMenuPrimitive.SubTriggerProps> & {
  inset?: boolean;
} = $props();
</script>

<ContextMenuPrimitive.SubTrigger
  bind:ref
  data-slot="context-menu-sub-trigger"
  data-inset={inset}
  class={cn(
    "focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground rounded-sm px-1.5 py-1 text-sm data-inset:pl-8 [&_svg:not([class*='size-'])]:size-3.5 flex cursor-default items-center outline-hidden select-none data-inset:ps-8 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <ChevronRightIcon class="ml-auto size-3.5" />
</ContextMenuPrimitive.SubTrigger>
