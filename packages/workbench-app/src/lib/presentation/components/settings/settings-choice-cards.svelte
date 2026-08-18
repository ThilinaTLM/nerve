<script lang="ts">
import { SelectRow } from "@nervekit/ui-kit/components/ui/select-row";
import { cn } from "@nervekit/ui-kit/core/utils";
import type { SettingsChoice } from "./types";

type Props = {
  items: SettingsChoice[];
  value?: string;
  ariaLabel: string;
  disabled?: boolean;
  class?: string;
  tourId?: string;
  onValueChange?: (value: string) => void;
};

let {
  items,
  value = $bindable(""),
  ariaLabel,
  disabled = false,
  class: className,
  tourId,
  onValueChange,
}: Props = $props();
</script>

<div
  class={cn("grid gap-1", className)}
  role="radiogroup"
  aria-label={ariaLabel}
  data-tour-id={tourId}
>
  {#each items as item (item.value)}
    <SelectRow
      label={item.label}
      detail={item.detail}
      selected={value === item.value}
      disabled={disabled || item.disabled}
      onclick={() => {
        if (disabled || item.disabled) return;
        value = item.value;
        onValueChange?.(item.value);
      }}
    />
  {/each}
</div>
