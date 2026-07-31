<script lang="ts">
import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
import CircleIcon from "@lucide/svelte/icons/circle";
import { cn, type WithoutChildrenOrChild } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  size = "default",
  ...restProps
}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> & {
  size?: "sm" | "default";
} = $props();
</script>

<RadioGroupPrimitive.Item
  bind:ref
  data-slot="radio-group-item"
  data-size={size}
  class={cn(
    "border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-destructive focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:aria-invalid:border-destructive/50 flex rounded-full data-[size=default]:size-4 data-[size=sm]:size-3.5 focus-visible:ring-3 aria-invalid:ring-3 group/radio-group-item peer relative aspect-square shrink-0 border outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked })}
    <div
      data-slot="radio-group-indicator"
      class="flex size-full items-center justify-center"
    >
      {#if checked}
        <CircleIcon
          class={cn(
            "bg-primary-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
            size === "sm" ? "size-1.5" : "size-2",
          )}
        />
      {/if}
    </div>
  {/snippet}
</RadioGroupPrimitive.Item>
