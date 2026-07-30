<script lang="ts">
import type { Snippet } from "svelte";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import SettingsRow from "./settings-row.svelte";

type Props = {
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  class?: string;
  badges?: Snippet;
  onCheckedChange?: (checked: boolean) => void;
};

let {
  label,
  description,
  checked = $bindable(false),
  disabled = false,
  class: className,
  badges,
  onCheckedChange,
}: Props = $props();

function handleCheckedChange(next: boolean): void {
  checked = next;
  onCheckedChange?.(next);
}
</script>

<SettingsRow {label} {description} {badges} class={className}>
  {#snippet control()}
    <Switch
      bind:checked
      {disabled}
      size="settings"
      aria-label={label}
      onCheckedChange={handleCheckedChange}
    />
  {/snippet}
</SettingsRow>
