<script lang="ts" generics="T">
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";

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
  /** Renders a single `SettingsListItem` row for each item. */
  row: Snippet<[T]>;
  /** Extra content below the list/empty state (e.g. inline warnings). */
  below?: Snippet;
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
  onAdd,
}: Props<T> = $props();
</script>

<SettingsSection id={sectionId} {title}>
  {#snippet actions()}
    <Button
      size="xs"
      data-tour-id={addTourId}
      onclick={onAdd}
      disabled={addDisabled}>{addLabel}</Button
    >
  {/snippet}

  {#if items.length === 0}
    <SettingsEmptyState
      variant="card"
      title={emptyTitle}
      description={emptyDescription}
    />
  {:else}
    <SettingsList ariaLabel={listAriaLabel} divided={false} gap="sm">
      {#each items as item (itemKey(item))}
        {@render row(item)}
      {/each}
    </SettingsList>
  {/if}

  {#if below}
    {@render below()}
  {/if}
</SettingsSection>
