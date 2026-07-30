<script lang="ts">
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsList,
  SettingsListItem,
  SettingsSearchInput,
  SettingsToolbar,
} from "$lib/presentation/components/settings";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutCategory,
  type ShortcutCommand,
} from "$lib/core/shortcuts/registry";
import { formatShortcut } from "$lib/core/shortcuts/keyboard";

type ShortcutGroup = {
  category: ShortcutCategory;
  commands: ShortcutCommand[];
};

const shortcutGroups = DEFAULT_SHORTCUTS.reduce<ShortcutGroup[]>(
  (groups, command) => {
    const group = groups.find(
      (candidate) => candidate.category === command.category,
    );
    if (group) group.commands.push(command);
    else groups.push({ category: command.category, commands: [command] });
    return groups;
  },
  [],
);

let query = $state("");

const filteredGroups = $derived.by<ShortcutGroup[]>(() => {
  const needle = query.trim().toLowerCase();
  if (!needle) return shortcutGroups;
  return shortcutGroups
    .map((group) => ({
      category: group.category,
      commands: group.commands.filter(
        (command) =>
          command.label.toLowerCase().includes(needle) ||
          group.category.toLowerCase().includes(needle) ||
          formatShortcut(command.defaultBinding).toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.commands.length > 0);
});
</script>

<SettingsToolbar>
  {#snippet start()}
    <SettingsSearchInput
      bind:value={query}
      placeholder="Search shortcuts"
      ariaLabel="Search shortcuts"
      class="max-w-xs"
    />
  {/snippet}
</SettingsToolbar>

{#each filteredGroups as group (group.category)}
  <SettingsGroup title={group.category}>
    <SettingsList ariaLabel={`${group.category} shortcuts`}>
      {#each group.commands as command (command.id)}
        <SettingsListItem title={command.label}>
          {#snippet meta()}
            <Kbd>{formatShortcut(command.defaultBinding)}</Kbd>
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  </SettingsGroup>
{/each}

{#if filteredGroups.length === 0}
  <SettingsEmptyState
    title="No matching shortcuts"
    description="Try a different search term."
  />
{/if}
