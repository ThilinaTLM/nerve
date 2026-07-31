<script lang="ts">
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { cn } from "@nervekit/ui-kit/core/utils";
import type { SettingsChoice } from "./types";

type Props = {
  items: SettingsChoice[];
  value?: string;
  ariaLabel: string;
  disabled?: boolean;
  class?: string;
  onValueChange?: (value: string) => void;
};

let {
  items,
  value = $bindable(""),
  ariaLabel,
  disabled = false,
  class: className,
  onValueChange,
}: Props = $props();
</script>

<RadioGroup.Root
  bind:value
  {disabled}
  aria-label={ariaLabel}
  {onValueChange}
  class={cn("grid gap-1", className)}
>
  {#each items as item (item.value)}
    <Label
      class="flex min-w-0 cursor-pointer items-baseline gap-2 rounded-sm border border-border/50 px-2 py-1.5 transition-colors hover:bg-accent/40 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/10 has-disabled:cursor-not-allowed has-disabled:opacity-50"
    >
      <RadioGroup.Item
        value={item.value}
        disabled={item.disabled}
        class="translate-y-0.5"
      />
      <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span class="flex-none text-sm font-medium">{item.label}</span>
        {#if item.detail}
          <span class="min-w-0 text-xs text-muted-foreground"
            >{item.detail}</span
          >
        {/if}
      </span>
    </Label>
  {/each}
</RadioGroup.Root>
