<script lang="ts">
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  id: string;
  label: string;
  value?: string;
  type?: "text" | "number";
  placeholder?: string;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  class?: string;
  onValueChange?: (value: string) => void;
};

let {
  id,
  label,
  value = $bindable(""),
  type = "text",
  placeholder,
  suffix,
  hint,
  min,
  max,
  step,
  disabled = false,
  class: className,
  onValueChange,
}: Props = $props();
</script>

<div class={cn("grid gap-1", className)}>
  <Label for={id} class="text-xs font-medium text-muted-foreground"
    >{label}</Label
  >
  <div class="flex items-center gap-2">
    <Input
      {id}
      {type}
      {placeholder}
      {min}
      {max}
      {step}
      {disabled}
      size="xs"
      bind:value
      oninput={(event) =>
        onValueChange?.((event.currentTarget as HTMLInputElement).value)}
    />
    {#if suffix}
      <span class="flex-none text-xs text-muted-foreground">{suffix}</span>
    {/if}
  </div>
  {#if hint}
    <p class="text-xs text-muted-foreground">{hint}</p>
  {/if}
</div>
