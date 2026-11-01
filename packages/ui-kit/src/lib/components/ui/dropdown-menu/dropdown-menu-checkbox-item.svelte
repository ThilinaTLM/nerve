<script lang="ts">
import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
import MinusIcon from "@lucide/svelte/icons/minus";
import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
import { cn, type WithoutChildrenOrChild } from "@nervekit/ui-kit/utils";
import type { Snippet } from "svelte";

let {
  ref = $bindable(null),
  checked = $bindable(false),
  indeterminate = $bindable(false),
  class: className,
  children: childrenProp,
  ...restProps
}: WithoutChildrenOrChild<DropdownMenuPrimitive.CheckboxItemProps> & {
  children?: Snippet;
} = $props();
</script>

<DropdownMenuPrimitive.CheckboxItem
  bind:ref
  bind:checked
  bind:indeterminate
  data-slot="dropdown-menu-checkbox-item"
  class={cn(
    "focus:bg-hover focus:text-foreground focus:**:text-foreground gap-1.5 rounded-sm py-1 pr-7 pl-1.5 text-ui data-inset:pl-8 [&_svg:not([class*='size-'])]:size-3.5 relative flex cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <span
      class="absolute right-2 flex items-center justify-center pointer-events-none"
      data-slot="dropdown-menu-checkbox-item-indicator"
    >
      {#if indeterminate}
        <MinusIcon />
      {:else if checked}
        <CircleCheckIcon />
      {/if}
    </span>
    {@render childrenProp?.()}
  {/snippet}
</DropdownMenuPrimitive.CheckboxItem>
