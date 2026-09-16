<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import { SvelteSet } from "svelte/reactivity";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { Settings } from "$lib/api";
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
  bulkSkillSets,
  filterSkills,
  orphanedSkills,
  shadowNote,
  skillSourceLabels,
  skillSourceSectionIds,
  sourcesForScope,
  summarizeSkills,
  type SkillEntry,
  type SkillSource,
} from "$lib/domain/skills/skill-catalog";
import type { SettingsChange } from "../settings-change";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";

type Props = {
  /** Where toggles are written: user defaults or this project's overrides. */
  scope: "user" | "project";
  settingsDraft: Settings;
  skills?: AvailableSkill[];
  configuration?: CapabilityConfiguration;
  projectName?: string;
  loading?: boolean;
  error?: string;
  onSettingsChange?: SettingsChange;
  onPatch?: (patch: CapabilityPatch) => void;
  onReset?: () => void;
  onTrust?: (trusted: boolean) => void;
  onRetry?: () => void;
};

let {
  scope,
  settingsDraft,
  skills = [],
  configuration,
  projectName,
  loading = false,
  error,
  onSettingsChange,
  onPatch,
  onReset,
  onTrust,
  onRetry,
}: Props = $props();

let query = $state("");

const sets = $derived({
  disabled: settingsDraft.skills.disabled,
  agentBrowserEnabled: settingsDraft.skills.agentBrowser.enabled,
});
const locked = $derived(
  scope === "project" &&
    (configuration?.trust.status === "untrusted" ||
      configuration?.trust.status === "invalid"),
);
const entries = $derived(
  buildSkillEntries({
    skills,
    scope,
    sets,
    project: configuration?.project,
  }),
);
const visibleEntries = $derived(filterSkills({ entries, query }));
const summary = $derived(summarizeSkills(visibleEntries));
const groupedEntries = $derived.by<
  Array<{ source: SkillSource; entries: SkillEntry[] }>
>(() =>
  sourcesForScope(scope)
    .map((source) => ({
      source,
      entries: visibleEntries.filter((entry) => entry.source === source),
    }))
    .filter((group) => group.entries.length > 0),
);
const orphans = $derived(
  orphanedSkills({
    skills,
    scope,
    sets,
    overrides: configuration?.project,
  }),
);
const overrideCount = $derived(
  configuration
    ? Object.keys(configuration.project.skills.file).length +
        Object.keys(configuration.project.skills.agentBrowser).length
    : 0,
);
const scopeNote = $derived(
  scope === "user"
    ? "Your defaults for every project. Projects and conversations can override them."
    : `Overrides for ${projectName ?? "this project"}. Skills without an override follow your user settings.`,
);

function persistUserSets(next: {
  disabled: string[];
  agentBrowserEnabled: string[];
}): void {
  settingsDraft.skills.disabled = next.disabled;
  settingsDraft.skills.agentBrowser.enabled = next.agentBrowserEnabled;
  onSettingsChange?.(
    {
      skills: {
        disabled: next.disabled,
        agentBrowser: { enabled: next.agentBrowserEnabled },
      },
    },
    { immediate: true },
  );
}

function setUserSkill(
  name: string,
  kind: "file" | "agentBrowser",
  enabled: boolean,
): void {
  const disabled = new SvelteSet(sets.disabled);
  const agentBrowserEnabled = new SvelteSet(sets.agentBrowserEnabled);
  if (kind === "agentBrowser") {
    if (enabled) agentBrowserEnabled.add(name);
    else agentBrowserEnabled.delete(name);
  } else if (enabled) disabled.delete(name);
  else disabled.add(name);
  const sorted = (names: SvelteSet<string>) =>
    [...names].sort((left, right) => left.localeCompare(right));
  persistUserSets({
    disabled: sorted(disabled),
    agentBrowserEnabled: sorted(agentBrowserEnabled),
  });
}

function toggleEntry(entry: SkillEntry, enabled: boolean): void {
  if (scope === "user") {
    setUserSkill(entry.skill.name, entry.kind, enabled);
    return;
  }
  onPatch?.({ skills: { [entry.kind]: { [entry.skill.name]: enabled } } });
}

function resetEntry(entry: SkillEntry): void {
  onPatch?.({ skills: { [entry.kind]: { [entry.skill.name]: null } } });
}

function clearOrphan(name: string, kind: "file" | "agentBrowser"): void {
  if (scope === "user") {
    const disabled = sets.disabled.filter(
      (entry) => kind !== "file" || entry !== name,
    );
    const agentBrowserEnabled = sets.agentBrowserEnabled.filter(
      (entry) => kind !== "agentBrowser" || entry !== name,
    );
    persistUserSets({ disabled, agentBrowserEnabled });
    return;
  }
  onPatch?.({ skills: { [kind]: { [name]: null } } });
}

function applyBulk(enabled: boolean): void {
  if (scope === "user") {
    persistUserSets(bulkSkillSets({ entries: visibleEntries, enabled, sets }));
    return;
  }
  const file: Record<string, boolean> = {};
  const agentBrowser: Record<string, boolean> = {};
  for (const entry of visibleEntries) {
    if (entry.kind === "agentBrowser") agentBrowser[entry.skill.name] = enabled;
    else file[entry.skill.name] = enabled;
  }
  onPatch?.({ skills: { file, agentBrowser } });
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

<SettingsInlineMessage tone="neutral" text={scopeNote} />

{#if scope === "project" && configuration}
  <ProjectCapabilityTrustNotice trust={configuration.trust} {onTrust} />
{/if}

{#if scope === "project" && !configuration && !loading}
  <SettingsInlineMessage
    tone="neutral"
    text="Select a project to configure project skill overrides."
  />
{:else if loading && entries.length === 0}
  <SettingsGroup>
    <Skeleton class="h-8 w-full" />
    <Skeleton class="h-8 w-full" />
    <Skeleton class="h-8 w-full" />
  </SettingsGroup>
{:else}
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
        disabled={visibleEntries.length === 0 || locked}
        title={`Enable ${visibleEntries.length} skills`}
        onclick={() => applyBulk(true)}
      >
        {query ? "Enable shown" : "Enable all"}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        class="text-muted-foreground"
        disabled={visibleEntries.length === 0 || locked}
        title={`Disable ${visibleEntries.length} skills`}
        onclick={() => applyBulk(false)}
      >
        {query ? "Disable shown" : "Disable all"}
      </Button>
      {#if scope === "project"}
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
      {/if}
    {/snippet}
  </SettingsToolbar>

  {#if groupedEntries.length === 0 && orphans.length === 0 && !error}
    <SettingsEmptyState
      title="No matching skills"
      description={scope === "user"
        ? "Skills come from your skills directory and the agent-browser CLI."
        : "Skills come from your skills directory, this project, and the agent-browser CLI."}
    />
  {/if}

  {#each groupedEntries as group (group.source)}
    <SettingsSection
      id={skillSourceSectionIds[group.source]}
      title={skillSourceLabels[group.source]}
      info={scope === "project"
        ? "Skills without a project override follow your user settings."
        : undefined}
    >
      <SettingsList ariaLabel={skillSourceLabels[group.source]}>
        {#each group.entries as entry (entry.skill.filePath)}
          <SettingsDisclosureItem
            title={entry.skill.name}
            description={entry.skill.description}
          >
            {#snippet badges()}
              {#if shadowNote(entry)}
                <Badge variant="neutral">{shadowNote(entry)}</Badge>
              {/if}
            {/snippet}
            {#snippet actions()}
              {#if entry.overridden}
                <Badge variant="neutral">Overridden here</Badge>
                <IconAction
                  icon={RotateCcw}
                  label={`Reset ${entry.skill.name} to your user setting`}
                  onclick={() => resetEntry(entry)}
                />
              {/if}
              <Switch
                size="settings"
                checked={entry.enabled}
                disabled={locked}
                aria-label={scope === "user"
                  ? `Enable ${entry.skill.name} skill`
                  : `Enable ${entry.skill.name} skill for this project`}
                onCheckedChange={(checked) => toggleEntry(entry, checked)}
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
                {#if scope === "project" && !entry.overridden}
                  <span class="flex-none text-xs text-muted-foreground">
                    User default: {entry.inherited ? "on" : "off"}
                  </span>
                {/if}
              </div>
            {/snippet}
          </SettingsDisclosureItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/each}

  {#if orphans.length > 0}
    <SettingsSection
      id="not-installed"
      title="Not installed"
      info="Stored settings for skills that are not on this machine, or that belong to another project."
    >
      <SettingsList ariaLabel="Not installed skills">
        {#each orphans as orphan (`${orphan.kind}:${orphan.name}`)}
          <SettingsDisclosureItem
            title={orphan.name}
            description={orphan.enabled
              ? "Stored as enabled, but no matching skill was found."
              : "Stored as disabled, but no matching skill was found."}
          >
            {#snippet actions()}
              <Button
                size="xs"
                variant="ghost"
                class="text-muted-foreground"
                onclick={() => clearOrphan(orphan.name, orphan.kind)}
              >
                Remove
              </Button>
            {/snippet}
            {#snippet detail()}
              <span class="text-xs text-muted-foreground">
                {orphan.kind === "agentBrowser"
                  ? "Agent Browser skill"
                  : "File skill"}
              </span>
            {/snippet}
          </SettingsDisclosureItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/if}
{/if}
