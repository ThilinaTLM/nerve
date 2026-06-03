<script lang="ts">
  import { Checkbox } from "bits-ui";
  import Check from "lucide-svelte/icons/check";
  import Minus from "lucide-svelte/icons/minus";
  import { cn } from "../../utils/cn";

  type Props = {
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
  };

  let {
    checked = $bindable(false),
    indeterminate = $bindable(false),
    disabled = false,
    id,
    ariaLabel,
    class: className = "",
    onCheckedChange,
  }: Props = $props();
</script>

<Checkbox.Root
  bind:checked
  bind:indeterminate
  {disabled}
  {id}
  aria-label={ariaLabel}
  {onCheckedChange}
  class={cn(
    "inline-flex size-4 items-center justify-center rounded-[0.25rem] border border-input bg-input/40 text-primary-foreground transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
    className,
  )}
>
  {#snippet children({ checked: isChecked, indeterminate: isIndeterminate })}
    {#if isIndeterminate}
      <Minus size={12} strokeWidth={3} />
    {:else if isChecked}
      <Check size={12} strokeWidth={3} />
    {/if}
  {/snippet}
</Checkbox.Root>
