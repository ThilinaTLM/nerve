<script lang="ts">
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { SelectRow } from "@nervekit/ui-kit/components/composites/select-row";
import { cn } from "@nervekit/ui-kit/utils";
import type { SettingsChoice } from "./settings-component-contracts";

type Props = {
  items: SettingsChoice[];
  value?: string;
  ariaLabel: string;
  disabled?: boolean;
  class?: string;
  tourId?: string;
  variant?: "cards" | "radio";
  onValueChange?: (value: string) => void;
};

let {
  items,
  value = $bindable(""),
  ariaLabel,
  disabled = false,
  class: className,
  tourId,
  variant = "cards",
  onValueChange,
}: Props = $props();
</script>

{#if variant === "radio"}
  <RadioGroup.Root
    bind:value
    {disabled}
    aria-label={ariaLabel}
    data-tour-id={tourId}
    {onValueChange}
    class={cn("grid gap-1", className)}
  >
    {#each items as item (item.value)}
      <Label
        class="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-transparent bg-accent/90 px-2 py-2 text-left transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70 has-data-[state=checked]:border-primary has-disabled:pointer-events-none has-disabled:opacity-55"
      >
        <RadioGroup.Item
          value={item.value}
          disabled={disabled || item.disabled}
          size="sm"
          class="translate-y-px"
        />
        <span
          class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap"
        >
          <span class="shrink-0 truncate text-xs font-medium text-foreground"
            >{item.label}</span
          >
          {#if item.detail}
            <span class="min-w-0 truncate text-xs text-muted-foreground"
              >{item.detail}</span
            >
          {/if}
        </span>
      </Label>
    {/each}
  </RadioGroup.Root>
{:else}
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
{/if}
