<script lang="ts">
  import type { Snippet } from "svelte";
  import PanelSection from "../workbench/panel-section.svelte";
  import NavigatorItem from "./navigator-item.svelte";
  import NavigatorPanel from "./navigator-panel.svelte";
  import {
    filterConversationGroups,
    type ConversationNavigatorGroup,
    type ConversationNavigatorItem,
  } from "./conversation-group-model.js";

  let {
    groups,
    searchValue = $bindable(""),
    placeholder = "Search conversations",
    onGroupOpenChange,
    onSelect,
    groupActions,
    itemTooltip,
  }: {
    groups: ConversationNavigatorGroup[];
    searchValue?: string;
    placeholder?: string;
    onGroupOpenChange?: (group: ConversationNavigatorGroup, open: boolean) => void;
    onSelect?: (
      item: ConversationNavigatorItem,
      group: ConversationNavigatorGroup,
    ) => void;
    groupActions?: Snippet<[ConversationNavigatorGroup]>;
    itemTooltip?: Snippet<[ConversationNavigatorItem, ConversationNavigatorGroup]>;
  } = $props();

  const visibleGroups = $derived(filterConversationGroups(groups, searchValue));
</script>

<NavigatorPanel bind:searchValue {placeholder}>
  <div class="grid gap-2 p-2">
    {#each visibleGroups as group (group.id)}
      <PanelSection
        title={group.title}
        icon={group.icon}
        open={group.open ?? true}
        onOpenChange={(open) => onGroupOpenChange?.(group, open)}
        contentClass="grid gap-0.5"
      >
        {#if group.meta}
          {#snippet meta()}<span>{group.meta}</span>{/snippet}
        {/if}
        {#if groupActions}
          {#snippet actions()}{@render groupActions(group)}{/snippet}
        {/if}
        {#each group.items as item (item.id)}
          {#if itemTooltip}
            <NavigatorItem
              title={item.title}
              subtitle={item.subtitle}
              active={item.active}
              isOpen={item.open}
              statusTone={item.statusTone}
              statusPulse={item.statusPulse}
              statusLabel={item.statusLabel}
              menuItems={item.menuItems}
              tooltipClass="conversation-tooltip"
              onSelect={() => onSelect?.(item, group)}
            >
              {#snippet tooltip()}{@render itemTooltip(item, group)}{/snippet}
            </NavigatorItem>
          {:else}
            <NavigatorItem
              title={item.title}
              subtitle={item.subtitle}
              active={item.active}
              isOpen={item.open}
              statusTone={item.statusTone}
              statusPulse={item.statusPulse}
              statusLabel={item.statusLabel}
              menuItems={item.menuItems}
              onSelect={() => onSelect?.(item, group)}
            />
          {/if}
        {:else}
          <p class="px-2 py-1 text-xs text-muted-foreground">
            {group.emptyLabel ?? "No conversations"}
          </p>
        {/each}
      </PanelSection>
    {:else}
      <p class="px-2 py-4 text-center text-xs text-muted-foreground">
        No matching conversations
      </p>
    {/each}
  </div>
</NavigatorPanel>
