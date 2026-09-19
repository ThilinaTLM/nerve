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
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";

type Props = {
  /** Where toggles are written: user defaults or this project's overrides. */
  scope: "user" | "project";
  settingsDraft: Settings;
  skills?: AvailableSkill[];
  configuration?: CapabilityConfiguration;
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
  nerveEnabled: settingsDraft.skills.nerve.enabled,
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
        Object.keys(configuration.project.skills.nerve).length +
        Object.keys(configuration.project.skills.agentBrowser).length
    : 0,
);

function persistUserSets(next: {
  disabled: string[];
  nerveEnabled: string[];
  agentBrowserEnabled: string[];
}): void {
  settingsDraft.skills.disabled = next.disabled;
  settingsDraft.skills.nerve.enabled = next.nerveEnabled;
  settingsDraft.skills.agentBrowser.enabled = next.agentBrowserEnabled;
  onSettingsChange?.(
    {
      skills: {
        disabled: next.disabled,
        nerve: { enabled: next.nerveEnabled },
        agentBrowser: { enabled: next.agentBrowserEnabled },
      },
    },
    { immediate: true },
  );
}

function setUserSkill(
  name: string,
  kind: "file" | "nerve" | "agentBrowser",
  enabled: boolean,
): void {
  const disabled = new SvelteSet(sets.disabled);
  const nerveEnabled = new SvelteSet(sets.nerveEnabled);
  const agentBrowserEnabled = new SvelteSet(sets.agentBrowserEnabled);
  if (kind === "agentBrowser") {
    if (enabled) agentBrowserEnabled.add(name);
    else agentBrowserEnabled.delete(name);
  } else if (kind === "nerve") {
    if (enabled) nerveEnabled.add(name);
    else nerveEnabled.delete(name);
  } else if (enabled) disabled.delete(name);
  else disabled.add(name);
  const sorted = (names: SvelteSet<string>) =>
    [...names].sort((left, right) => left.localeCompare(right));
  persistUserSets({
    disabled: sorted(disabled),
    nerveEnabled: sorted(nerveEnabled),
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

function clearOrphans(
  removed: Array<{
    name: string;
    kind: "file" | "nerve" | "agentBrowser";
  }>,
): void {
  if (scope === "user") {
    const gone = new Set(removed.map((entry) => `${entry.kind}:${entry.name}`));
    persistUserSets({
      disabled: sets.disabled.filter((name) => !gone.has(`file:${name}`)),
      nerveEnabled: sets.nerveEnabled.filter(
        (name) => !gone.has(`nerve:${name}`),
      ),
      agentBrowserEnabled: sets.agentBrowserEnabled.filter(
        (name) => !gone.has(`agentBrowser:${name}`),
      ),
    });
    return;
  }
  const file: Record<string, null> = {};
  const nerve: Record<string, null> = {};
  const agentBrowser: Record<string, null> = {};
  for (const entry of removed) {
    if (entry.kind === "agentBrowser") agentBrowser[entry.name] = null;
    else if (entry.kind === "nerve") nerve[entry.name] = null;
    else file[entry.name] = null;
  }
  onPatch?.({ skills: { file, nerve, agentBrowser } });
}

function clearAllOrphans(): void {
  clearOrphans(orphans);
}

function applyBulk(enabled: boolean): void {
  if (scope === "user") {
    persistUserSets(bulkSkillSets({ entries: visibleEntries, enabled, sets }));
    return;
  }
  const file: Record<string, boolean> = {};
  const nerve: Record<string, boolean> = {};
  const agentBrowser: Record<string, boolean> = {};
  for (const entry of visibleEntries) {
    if (entry.kind === "agentBrowser") agentBrowser[entry.skill.name] = enabled;
    else if (entry.kind === "nerve") nerve[entry.skill.name] = enabled;
    else file[entry.skill.name] = enabled;
  }
  onPatch?.({ skills: { file, nerve, agentBrowser } });
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
        {#if configuration}
          <ProjectCapabilityTrustAction trust={configuration.trust} {onTrust} />
        {/if}
      {/if}
    {/snippet}
  </SettingsToolbar>

  {#if groupedEntries.length === 0 && orphans.length === 0 && !error}
    <SettingsEmptyState
      title="No matching skills"
      description={scope === "user"
        ? "Skills come from your skills directory, Nerve, and the agent-browser CLI."
        : "Skills come from your skills directory, this project, Nerve, and the agent-browser CLI."}
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
      id="unused-entries"
      title="Unused entries"
      info={scope === "user"
        ? "Saved on/off decisions for skill names that are not installed for you, usually a project's own skill or a leftover from an earlier version. They do nothing today, but would apply to any future skill taking that name."
        : "Project overrides for skill names that are no longer installed. They do nothing today, but would apply to any future skill taking that name."}
    >
      {#snippet actions()}
        <Button
          size="xs"
          variant="ghost"
          class="text-muted-foreground"
          onclick={clearAllOrphans}
        >
          Remove all
        </Button>
      {/snippet}
      <SettingsList ariaLabel="Unused skill entries">
        {#each orphans as orphan (`${orphan.kind}:${orphan.name}`)}
          <SettingsDisclosureItem
            title={orphan.name}
            description={`Saved as ${orphan.enabled ? "enabled" : "disabled"}, but no skill with this name is installed ${scope === "user" ? "for you" : "for this project"}.`}
          >
            {#snippet actions()}
              <Button
                size="xs"
                variant="ghost"
                class="text-muted-foreground"
                onclick={() => clearOrphans([orphan])}
              >
                Remove
              </Button>
            {/snippet}
            {#snippet detail()}
              <span class="text-xs text-muted-foreground">
                {orphan.kind === "agentBrowser"
                  ? "Agent Browser skill entry"
                  : "File skill entry"}
              </span>
            {/snippet}
          </SettingsDisclosureItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/if}
{/if}
