<script lang="ts" generics="T">
import {
  PageEmptyState,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsSection } from "$lib/presentation/settings";

type Props<T> = {
  sectionId: string;
  title: string;
  addLabel: string;
  addTourId?: string;
  addDisabled?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  items: T[];
  listAriaLabel: string;
  itemKey: (item: T) => string;
  /** Renders a single `PageItem` row for each item. */
  row: Snippet<[T]>;
  /** Extra content below the list/empty state (e.g. inline warnings). */
  below?: Snippet;
  /** Notes under the card, outside the list surface. */
  footer?: Snippet;
  onAdd: () => void;
};

let {
  sectionId,
  title,
  addLabel,
  addTourId,
  addDisabled = false,
  emptyTitle,
  emptyDescription,
  items,
  listAriaLabel,
  itemKey,
  row,
  below,
  footer,
  onAdd,
}: Props<T> = $props();
</script>

<SettingsSection id={sectionId} {title} {footer}>
  {#snippet actions()}
    <Button
      variant="outline"
      size="sm"
      data-tour-id={addTourId}
      onclick={onAdd}
      disabled={addDisabled}>{addLabel}</Button
    >
  {/snippet}

  {#if items.length === 0}
    <PageEmptyState
      variant="card"
      title={emptyTitle}
      description={emptyDescription}
    />
  {:else}
    <PageList ariaLabel={listAriaLabel}>
      {#each items as item (itemKey(item))}
        {@render row(item)}
      {/each}
    </PageList>
  {/if}

  {#if below}
    {@render below()}
  {/if}
</SettingsSection>
