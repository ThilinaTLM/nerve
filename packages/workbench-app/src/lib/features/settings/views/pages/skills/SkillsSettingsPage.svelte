<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import Copy from "@lucide/svelte/icons/copy";
import type { AvailableSkill, Settings } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  SettingsDisclosureItem,
  SettingsEmptyState,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import {
  buildSkillEntries,
  bulkSkillSets,
  filterSkills,
  skillSourceLabels,
  skillSourceSectionIds,
  summarizeSkills,
  type SkillEntry,
  type SkillSource,
} from "./skills-filter";

type Props = {
  settingsDraft: Settings;
  agentBrowserSkills?: AvailableSkill[];
  globalSkills?: AvailableSkill[];
  projectSkills?: AvailableSkill[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  agentBrowserSkills = [],
  globalSkills = [],
  projectSkills = [],
  loading = false,
  error,
  onRetry,
  onSettingsChange,
}: Props = $props();

let query = $state("");

const entries = $derived(
  buildSkillEntries({
    agentBrowserSkills,
    globalSkills,
    projectSkills,
    sets: {
      disabled: settingsDraft.skills.disabled,
      agentBrowserEnabled: settingsDraft.skills.agentBrowser.enabled,
    },
  }),
);
const visibleEntries = $derived(filterSkills({ entries, query }));
const summary = $derived(summarizeSkills(visibleEntries));
const groupedEntries = $derived.by<
  Array<{ source: SkillSource; entries: SkillEntry[] }>
>(() => {
  const sources: SkillSource[] = ["agentBrowser", "global", "project"];
  return sources
    .map((source) => ({
      source,
      entries: visibleEntries.filter((entry) => entry.source === source),
    }))
    .filter((group) => group.entries.length > 0);
});

function setSkillEnabled(name: string, enabled: boolean): void {
  const next = new SvelteSet(settingsDraft.skills.disabled);
  if (enabled) next.delete(name);
  else next.add(name);
  const disabled = [...next].sort((left, right) => left.localeCompare(right));
  settingsDraft.skills.disabled = disabled;
  onSettingsChange?.({ skills: { disabled } }, { immediate: true });
}

function setAgentBrowserSkillEnabled(name: string, enabled: boolean): void {
  const next = new SvelteSet(settingsDraft.skills.agentBrowser.enabled);
  if (enabled) next.add(name);
  else next.delete(name);
  const enabledNames = [...next].sort((left, right) =>
    left.localeCompare(right),
  );
  settingsDraft.skills.agentBrowser.enabled = enabledNames;
  onSettingsChange?.(
    { skills: { agentBrowser: { enabled: enabledNames } } },
    { immediate: true },
  );
}

function toggleEntry(entry: SkillEntry, enabled: boolean): void {
  if (entry.source === "agentBrowser") {
    setAgentBrowserSkillEnabled(entry.skill.name, enabled);
    return;
  }
  setSkillEnabled(entry.skill.name, enabled);
}

function applyBulk(enabled: boolean): void {
  const sets = bulkSkillSets({
    entries: visibleEntries,
    enabled,
    sets: {
      disabled: settingsDraft.skills.disabled,
      agentBrowserEnabled: settingsDraft.skills.agentBrowser.enabled,
    },
  });
  settingsDraft.skills.disabled = sets.disabled;
  settingsDraft.skills.agentBrowser.enabled = sets.agentBrowserEnabled;
  onSettingsChange?.(
    {
      skills: {
        disabled: sets.disabled,
        agentBrowser: { enabled: sets.agentBrowserEnabled },
      },
    },
    { immediate: true },
  );
}

function copyPath(path: string): void {
  void navigator.clipboard?.writeText(path);
}
</script>

<SettingsToolbar>
  {#snippet start()}
    <SearchInput
      bind:value={query}
      placeholder="Search skills"
      ariaLabel="Search skills"
      class="max-w-xs"
    >
      {#snippet trailing()}
        <span class="flex-none text-xs text-muted-foreground"
          >{summary.enabled} of {summary.total} enabled</span
        >
      {/snippet}
    </SearchInput>
  {/snippet}
  {#snippet end()}
    <Button
      size="xs"
      variant="ghost"
      class="text-muted-foreground"
      disabled={visibleEntries.length === 0}
      title={`Enable ${visibleEntries.length} skills`}
      onclick={() => applyBulk(true)}
    >
      {query ? "Enable shown" : "Enable all"}
    </Button>
    <Button
      size="xs"
      variant="ghost"
      class="text-muted-foreground"
      disabled={visibleEntries.length === 0}
      title={`Disable ${visibleEntries.length} skills`}
      onclick={() => applyBulk(false)}
    >
      {query ? "Disable shown" : "Disable all"}
    </Button>
  {/snippet}
</SettingsToolbar>

{#if error}
  <SettingsInlineMessage tone="error" text={error}>
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={onRetry}>Retry</Button>
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#if loading}
  <SettingsGroup>
    <Skeleton class="h-8 w-full" />
    <Skeleton class="h-8 w-full" />
    <Skeleton class="h-8 w-full" />
  </SettingsGroup>
{:else if groupedEntries.length === 0 && !error}
  <SettingsEmptyState
    title="No matching skills"
    description="Skills come from the agent-browser CLI, your global skills directory, and the active project."
  />
{:else}
  {#each groupedEntries as group (group.source)}
    <SettingsSection
      id={skillSourceSectionIds[group.source]}
      title={skillSourceLabels[group.source]}
    >
      <SettingsList ariaLabel={`${skillSourceLabels[group.source]} skills`}>
        {#each group.entries as entry (entry.skill.filePath)}
          <SettingsDisclosureItem
            title={entry.skill.name}
            description={entry.skill.description}
          >
            {#snippet badges()}
              {#if entry.overrideNote}
                <Badge variant="secondary" size="xs">{entry.overrideNote}</Badge
                >
              {/if}
            {/snippet}
            {#snippet actions()}
              <Switch
                size="settings"
                checked={entry.enabled}
                aria-label={`Enable ${entry.skill.name} skill`}
                onCheckedChange={(checked) => toggleEntry(entry, checked)}
              />
            {/snippet}
            {#snippet detail()}
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-mono" title={entry.skill.filePath}
                  >{entry.skill.filePath}</span
                >
                <Button
                  variant="ghost"
                  size="icon-xs"
                  ariaLabel="Copy skill path"
                  onclick={() => copyPath(entry.skill.filePath)}
                >
                  <Copy class="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            {/snippet}
          </SettingsDisclosureItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/each}
{/if}
