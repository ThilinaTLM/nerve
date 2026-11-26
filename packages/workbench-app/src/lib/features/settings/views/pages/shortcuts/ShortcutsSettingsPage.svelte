<script lang="ts">
import { matchesTerms } from "@nervekit/ui-kit/collections/match-terms";
import {
  PageEmptyState,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import {
  SETTINGS_SEARCH_MIN,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutCategory,
  type ShortcutCommand,
} from "$lib/application/commands/command-registry";
import { formatShortcut } from "$lib/application/commands/keyboard";

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
  if (!query.trim()) return shortcutGroups;
  return shortcutGroups
    .map((group) => ({
      category: group.category,
      commands: group.commands.filter((command) =>
        matchesTerms(
          query,
          command.label,
          group.category,
          formatShortcut(command.defaultBinding),
        ),
      ),
    }))
    .filter((group) => group.commands.length > 0);
});
</script>

{#if DEFAULT_SHORTCUTS.length >= SETTINGS_SEARCH_MIN}
  <SettingsToolbar>
    {#snippet start()}
      <SearchInput
        bind:value={query}
        placeholder="Search shortcuts"
        ariaLabel="Search shortcuts"
        class="max-w-xs"
      />
    {/snippet}
  </SettingsToolbar>
{/if}

{#each filteredGroups as group (group.category)}
  <SettingsSection surface={false} title={group.category}>
    <PageList ariaLabel={`${group.category} shortcuts`}>
      {#each group.commands as command (command.id)}
        <PageItem compact title={command.label}>
          {#snippet meta()}
            <span
              class="whitespace-nowrap font-mono text-caption text-muted-foreground"
              >{formatShortcut(command.defaultBinding)}</span
            >
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  </SettingsSection>
{/each}

{#if filteredGroups.length === 0}
  <PageEmptyState
    title="No matching shortcuts"
    description="Try a different search term."
  />
{/if}
