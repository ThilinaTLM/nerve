<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import Copy from "@lucide/svelte/icons/copy";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import { skillOverrideKind } from "@nervekit/contracts/skills";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  SettingsChangeIndicator,
  SettingsDisclosureItem,
  SettingsEmptyState,
  SettingsList,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import {
  filterSkills,
  shadowNote,
  skillSourceLabels,
  skillSourceSectionIds,
  sourcesForScope,
  summarizeSkills,
  type SkillEntry,
} from "$lib/domain/skills/skill-catalog";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
let {
  scope,
  projectId,
  skills = [],
  error: catalogError,
}: {
  scope: "user" | "project";
  projectId?: string;
  skills?: AvailableSkill[];
  loading?: boolean;
  error?: string;
} = $props();
const editor = new ScopedAgentState();
$effect(() => {
  if (
    !workbenchStartupState.progressiveActive ||
    (scope === "project" && !projectId)
  )
    return;
  void editor.load(
    scope === "project" ? { scope, projectId: projectId! } : { scope },
  );
});
$effect(() => editor.observe());
const locked = $derived(editor.saving || !editor.resolution);
const error = $derived(editor.error ?? catalogError);
let query = $state("");
const escape = (value: string) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
function pointer(entry: SkillEntry) {
  return `/skills/${entry.kind}/${escape(entry.skill.name)}`;
}
const entries = $derived<SkillEntry[]>(
  skills
    .filter((s) => sourcesForScope(scope).includes(s.source))
    .map((skill) => {
      const kind = skillOverrideKind(skill.source);
      const settings = editor.resolution?.settings.skills;
      const inherited = editor.inherited?.settings.skills;
      return {
        skill,
        kind,
        source: skill.source,
        enabled:
          settings?.[kind]?.[skill.name] ?? settings?.defaults?.[kind] ?? false,
        inherited:
          inherited?.[kind]?.[skill.name] ??
          inherited?.defaults?.[kind] ??
          false,
        overridden: editor.overrides.skills?.[kind]?.[skill.name] !== undefined,
      };
    }),
);
const visibleEntries = $derived(filterSkills({ entries, query }));
const summary = $derived(summarizeSkills(visibleEntries));
const groupedEntries = $derived(
  sourcesForScope(scope)
    .map((source) => ({
      source,
      entries: visibleEntries.filter((e) => e.source === source),
    }))
    .filter((g) => g.entries.length),
);
const orphans = $derived.by(() => {
  const result: {
    kind: "file" | "nerve" | "agentBrowser";
    name: string;
    enabled: boolean;
  }[] = [];
  for (const kind of ["file", "nerve", "agentBrowser"] as const)
    for (const [name, enabled] of Object.entries(
      editor.overrides.skills?.[kind] ?? {},
    ))
      if (!entries.some((e) => e.kind === kind && e.skill.name === name))
        result.push({ kind, name, enabled });
  return result;
});
function toggleEntry(entry: SkillEntry, enabled: boolean) {
  void editor.save({
    skills: { [entry.kind]: { [entry.skill.name]: enabled } },
  });
}
function resetEntry(entry: SkillEntry) {
  void editor.save({}, [`/overrides${pointer(entry)}`]);
}
function applyBulk(enabled: boolean) {
  const skills: NonNullable<LeadSettingsOverrides["skills"]> = {};
  for (const e of visibleEntries)
    skills[e.kind] = { ...skills[e.kind], [e.skill.name]: enabled };
  void editor.save({ skills });
}
function clearOrphans(values: typeof orphans) {
  void editor.save(
    {},
    values.map((v) => `/overrides/skills/${v.kind}/${escape(v.name)}`),
  );
}
function clearAllOrphans() {
  clearOrphans(orphans);
}
function copyPath(path: string) {
  void writeClipboardText(path);
}
function onRetry() {
  return editor.reload();
}
</script>

{#if scope === "project"}<ProjectCapabilityTrustNotice
    document={editor.document}
    scope={editor.scope}
    onReload={onRetry}
  />{/if}
{#if error}
  <Callout layout="block" tone="destructive" text={error}>
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={onRetry}>Retry</Button>
    {/snippet}
  </Callout>
{/if}

{#if !editor.resolution && !error}
  <Skeleton class="h-8 w-full" />
{:else if editor.resolution}
  <SettingsToolbar>
    {#snippet start()}
      <SearchInput
        bind:value={query}
        placeholder="Search skills"
        ariaLabel="Search skills"
        class="max-w-xs"
      >
        {#snippet trailing()}
          <span class="flex-none text-ui text-muted-foreground"
            >{summary.enabled} of {summary.total} enabled</span
          >
        {/snippet}
      </SearchInput>
    {/snippet}
    {#snippet end()}
      {#if scope === "project"}<ProjectCapabilityTrustAction
          document={editor.document}
          scope={editor.scope}
          onReload={onRetry}
        />{/if}
      <Button
        size="sm"
        variant="ghost"
        class="text-muted-foreground"
        disabled={visibleEntries.length === 0 || locked}
        title={`Enable ${visibleEntries.length} skills`}
        onclick={() => applyBulk(true)}
      >
        {query ? "Enable shown" : "Enable all"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="text-muted-foreground"
        disabled={visibleEntries.length === 0 || locked}
        title={`Disable ${visibleEntries.length} skills`}
        onclick={() => applyBulk(false)}
      >
        {query ? "Disable shown" : "Disable all"}
      </Button>
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
                <SettingsChangeIndicator
                  {scope}
                  from={entry.inherited ? "On" : "Off"}
                  to={entry.enabled ? "On" : "Off"}
                  onReset={() => resetEntry(entry)}
                />
              {/if}
              <Switch
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
                  <span class="flex-none text-ui text-muted-foreground">
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
          size="sm"
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
                size="sm"
                variant="ghost"
                class="text-muted-foreground"
                onclick={() => clearOrphans([orphan])}
              >
                Remove
              </Button>
            {/snippet}
            {#snippet detail()}
              <span class="text-ui text-muted-foreground">
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
