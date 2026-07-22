<script lang="ts">
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  checked?: boolean;
  disabled?: boolean;
  label?: string;
  description?: string;
  class?: string;
  onCheckedChange?: (checked: boolean) => void;
};

let {
  checked = $bindable(false),
  disabled = false,
  label,
  description,
  class: className = "",
  onCheckedChange,
}: Props = $props();

function handleCheckedChange(next: boolean) {
  checked = next;
  onCheckedChange?.(next);
}
</script>

<label
  class={cn(
    "flex items-center justify-between gap-3 text-sm text-foreground",
    className,
  )}
>
  <span class="grid min-w-0 gap-0.5">
    {#if label}<span>{label}</span>{/if}
    {#if description}
      <small class="text-xs text-muted-foreground">{description}</small>
    {/if}
  </span>
  <Switch
    bind:checked
    {disabled}
    size="settings"
    onCheckedChange={handleCheckedChange}
    aria-label={label}
  />
</label>
