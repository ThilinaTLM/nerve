<script lang="ts">
import type { Snippet } from "svelte";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import FieldRow from "./field-row.svelte";

type Props = {
  /** Row label; also the switch's accessible name. */
  label: string;
  /** One muted line under the label. */
  description?: string;
  /** Switch state (bindable). */
  checked?: boolean;
  disabled?: boolean;
  class?: string;
  /** Inline after the label. */
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

<FieldRow {label} {description} {badges} class={className}>
  {#snippet control()}
    <Switch
      bind:checked
      {disabled}
      aria-label={label}
      onCheckedChange={handleCheckedChange}
    />
  {/snippet}
</FieldRow>
