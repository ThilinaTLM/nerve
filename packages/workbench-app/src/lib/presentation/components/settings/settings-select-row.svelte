<script lang="ts">
import type { Snippet } from "svelte";
import SettingsRow from "./settings-row.svelte";

type Props = {
  label: string;
  description?: string;
  htmlFor?: string;
  class?: string;
  /** Rendered inside a fixed-width control column; receives the disabled state. */
  control: Snippet<[boolean]>;
  disabled?: boolean;
};

let {
  label,
  description,
  htmlFor,
  class: className,
  control: controlSnippet,
  disabled = false,
}: Props = $props();
</script>

<SettingsRow {label} {description} {htmlFor} class={className}>
  {#snippet control()}
    <div class="w-48 min-w-0">
      {@render controlSnippet(disabled)}
    </div>
  {/snippet}
</SettingsRow>
