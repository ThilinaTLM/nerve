<script lang="ts" module>
export type PanelFilterScope = {
  /** Stable value reported through `scope` / `onScopeChange`. */
  value: string;
  /** Chip text. */
  label: string;
  /** Item count shown after the label ("All 6"). Omit for no count. */
  count?: number;
  /** Tooltip explaining what the scope includes. */
  title?: string;
};
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { cn } from "@nervekit/ui-kit/utils";

let {
  query = $bindable(""),
  placeholder,
  ariaLabel,
  scopes,
  scope = $bindable(),
  scopeLabel = "Filter scope",
  onScopeChange,
  extra,
  class: className,
}: {
  /** Search text. */
  query?: string;
  /** Placeholder of the search field; the field renders only when it is set (omit it for chips only). */
  placeholder?: string;
  /** Accessible name of the search field. */
  ariaLabel?: string;
  /** Scope chips under the field. Omit or leave empty to render search only. */
  scopes?: PanelFilterScope[];
  /** Selected scope `value`. */
  scope?: string;
  /** Accessible name of the chip group. */
  scopeLabel?: string;
  /** Called when the user picks a different scope. */
  onScopeChange?: (scope: string) => void;
  /** Extra controls rendered below the chips. */
  extra?: Snippet;
  class?: string;
} = $props();

const showSearch = $derived(placeholder !== undefined);
</script>

<div class={cn("flex shrink-0 flex-col gap-1.5 pt-1 pb-1.5", className)}>
  {#if showSearch}
    <SearchInput bind:value={query} {placeholder} {ariaLabel} />
  {/if}
  {#if scopes && scopes.length > 0}
    <ToggleGroup.Root
      type="single"
      variant="chip"
      size="sm"
      value={scope}
      aria-label={scopeLabel}
      onValueChange={(value) => {
        if (!value) return;
        scope = value;
        onScopeChange?.(value);
      }}
    >
      {#each scopes as item (item.value)}
        <ToggleGroup.Item value={item.value} title={item.title}
          >{item.count === undefined
            ? item.label
            : `${item.label} ${item.count}`}</ToggleGroup.Item
        >
      {/each}
    </ToggleGroup.Root>
  {/if}
  {@render extra?.()}
</div>
