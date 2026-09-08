<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { AvailableSkill, Settings } from "$lib/api";
import {
  SettingsDisclosureItem,
  SettingsEmptyState,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import {
  buildSkillEntries,
  filterSkills,
  skillSourceLabels,
  skillSourceSectionIds,
  type SkillEntry,
  type SkillSource,
} from "../skills/skills-filter";
import ProjectCapabilityTrustNotice from "./ProjectCapabilityTrustNotice.svelte";

type Props = {
  configuration?: CapabilityConfiguration;
  settingsDraft: Settings;
  agentBrowserSkills?: AvailableSkill[];
  globalSkills?: AvailableSkill[];
  projectSkills?: AvailableSkill[];
  loading?: boolean;
  error?: string;
  onPatch?: (patch: CapabilityPatch) => void;
  onReset?: () => void;
  onTrust?: (trusted: boolean) => void;
  onRetry?: () => void;
};

let {
  configuration,
  settingsDraft,
  agentBrowserSkills = [],
  globalSkills = [],
  projectSkills = [],
  loading = false,
  error,
  onPatch,
  onReset,
  onTrust,
  onRetry,
}: Props = $props();

type ProjectSkillEntry = SkillEntry & {
  overridden: boolean;
  group: "file" | "agentBrowser";
};

let query = $state("");

const overrides = $derived(
  configuration?.project.skills ?? { file: {}, agentBrowser: {} },
);
const overrideCount = $derived(
  Object.keys(overrides.file).length +
    Object.keys(overrides.agentBrowser).length,
);
const locked = $derived(
  configuration?.trust.status === "untrusted" ||
    configuration?.trust.status === "invalid",
);

/** Project rows show the user default overlaid with this project's overrides. */
const entries = $derived(
  buildSkillEntries({
    agentBrowserSkills,
    globalSkills,
    projectSkills,
    sets: {
      disabled: settingsDraft.skills.disabled,
      agentBrowserEnabled: settingsDraft.skills.agentBrowser.enabled,
    },
  }).map((entry) => {
    const group: "file" | "agentBrowser" =
      entry.source === "agentBrowser" ? "agentBrowser" : "file";
    const override = overrides[group][entry.skill.name];
    return {
      ...entry,
      enabled: override ?? entry.enabled,
      overridden: override !== undefined,
      group,
    };
  }),
);
const visibleEntries = $derived(
  filterSkills({ entries, query }) as ProjectSkillEntry[],
);
const groupedEntries = $derived.by<
  Array<{ source: SkillSource; entries: ProjectSkillEntry[] }>
>(() => {
  const sources: SkillSource[] = ["agentBrowser", "global", "project"];
  return sources
    .map((source) => ({
      source,
      entries: visibleEntries.filter((entry) => entry.source === source),
    }))
    .filter((group) => group.entries.length > 0);
});
const enabledCount = $derived(
  visibleEntries.filter((entry) => entry.enabled).length,
);

function setSkill(entry: ProjectSkillEntry, enabled: boolean): void {
  onPatch?.({ skills: { [entry.group]: { [entry.skill.name]: enabled } } });
}

function resetSkill(entry: ProjectSkillEntry): void {
  onPatch?.({ skills: { [entry.group]: { [entry.skill.name]: null } } });
}

function copyPath(path: string): void {
  void navigator.clipboard?.writeText(path);
}
</script>

{#if error}
  <SettingsInlineMessage tone="destructive" text={error}>
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={() => onRetry?.()}
        >Retry</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#if !configuration && loading}
  <SettingsGroup>
    <Skeleton class="h-8 w-full" />
    <Skeleton class="h-8 w-full" />
    <Skeleton class="h-8 w-full" />
  </SettingsGroup>
{:else if configuration}
  <ProjectCapabilityTrustNotice trust={configuration.trust} {onTrust} />

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
            >{enabledCount} of {visibleEntries.length} enabled</span
          >
        {/snippet}
      </SearchInput>
    {/snippet}
    {#snippet end()}
      <Button
        size="xs"
        variant="ghost"
        class="text-muted-foreground"
        disabled={overrideCount === 0}
        title={`Reset ${overrideCount} project skill overrides`}
        onclick={() => onReset?.()}
      >
        <RotateCcw class="size-3.5" />Reset all
      </Button>
    {/snippet}
  </SettingsToolbar>

  {#if groupedEntries.length === 0}
    <SettingsEmptyState
      title="No matching skills"
      description="Skills come from the agent-browser CLI, your global skills directory, and this project."
    />
  {:else}
    {#each groupedEntries as group (group.source)}
      <SettingsSection
        id={skillSourceSectionIds[group.source]}
        title={skillSourceLabels[group.source]}
        info="Skills without a project override follow your user settings."
      >
        <SettingsList ariaLabel={`${skillSourceLabels[group.source]} skills`}>
          {#each group.entries as entry (entry.skill.filePath)}
            <SettingsDisclosureItem
              title={entry.skill.name}
              description={entry.skill.description}
            >
              {#snippet badges()}
                {#if entry.overrideNote}
                  <Badge variant="neutral">{entry.overrideNote}</Badge>
                {/if}
              {/snippet}
              {#snippet actions()}
                {#if entry.overridden}
                  <Badge variant="neutral">Project</Badge>
                  <IconAction
                    icon={RotateCcw}
                    label={`Reset ${entry.skill.name} to your user setting`}
                    onclick={() => resetSkill(entry)}
                  />
                {/if}
                <Switch
                  size="settings"
                  checked={entry.enabled}
                  disabled={locked || loading}
                  aria-label={`Enable ${entry.skill.name} skill for this project`}
                  onCheckedChange={(checked) => setSkill(entry, checked)}
                />
              {/snippet}
              {#snippet detail()}
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-mono" title={entry.skill.filePath}
                    >{entry.skill.filePath}</span
                  >
                  <IconAction
                    icon={Copy}
                    label="Copy skill path"
                    onclick={() => copyPath(entry.skill.filePath)}
                  />
                </div>
              {/snippet}
            </SettingsDisclosureItem>
          {/each}
        </SettingsList>
      </SettingsSection>
    {/each}
  {/if}
{:else}
  <SettingsInlineMessage
    tone="neutral"
    text="Select a project to configure project skill overrides."
  />
{/if}
