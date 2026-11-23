<script lang="ts">
import { FieldRow } from "@nervekit/ui-kit/components/composites/page";
import type { Snippet } from "svelte";

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

<FieldRow {label} {description} {htmlFor} class={className}>
  {#snippet control()}
    <div class="w-48 min-w-0 group-data-page-divided/surface:w-full">
      {@render controlSnippet(disabled)}
    </div>
  {/snippet}
</FieldRow>
