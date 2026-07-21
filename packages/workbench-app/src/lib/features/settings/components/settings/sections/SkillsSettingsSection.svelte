<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import type {
  AvailableSkill,
  ProjectRecord,
  Settings,
  UpdateSettingsRequest,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Switch as ToggleSwitch } from "@nervekit/ui-kit/components/ui/switch";
import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

type Props = {
  settingsDraft: Settings;
  activeProject?: ProjectRecord;
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
  activeProject,
  agentBrowserSkills = [],
  globalSkills = [],
  projectSkills = [],
  loading = false,
  error,
  onRetry,
  onSettingsChange,
}: Props = $props();

const sortedAgentBrowserSkills = $derived(
  agentBrowserSkills.toSorted((a, b) => a.name.localeCompare(b.name)),
);
const sortedGlobalSkills = $derived(
  globalSkills.toSorted((a, b) => a.name.localeCompare(b.name)),
);
const sortedProjectSkills = $derived(
  projectSkills.toSorted((a, b) => a.name.localeCompare(b.name)),
);
const disabledSkills = $derived(new Set(settingsDraft.skills.disabled));
const enabledAgentBrowserSkills = $derived(
  new Set(settingsDraft.skills.agentBrowser.enabled),
);
const overriddenAgentBrowserNames = $derived(
  new Set([...projectSkills, ...globalSkills].map((skill) => skill.name)),
);
const duplicateNames = $derived(
  new Set(
    globalSkills
      .filter((skill) =>
        projectSkills.some((candidate) => candidate.name === skill.name),
      )
      .map((skill) => skill.name),
  ),
);

function setSkillEnabled(name: string, enabled: boolean) {
  const next = new SvelteSet(settingsDraft.skills.disabled);
  if (enabled) next.delete(name);
  else next.add(name);
  const disabled = [...next].sort((a, b) => a.localeCompare(b));
  settingsDraft.skills.disabled = disabled;
  onSettingsChange?.({ skills: { disabled } }, { immediate: true });
}

function setAgentBrowserSkillEnabled(name: string, enabled: boolean) {
  const next = new SvelteSet(settingsDraft.skills.agentBrowser.enabled);
  if (enabled) next.add(name);
  else next.delete(name);
  const enabledNames = [...next].sort((a, b) => a.localeCompare(b));
  settingsDraft.skills.agentBrowser.enabled = enabledNames;
  onSettingsChange?.(
    { skills: { agentBrowser: { enabled: enabledNames } } },
    { immediate: true },
  );
}
</script>

{#snippet skillList(
  skills: AvailableSkill[],
  emptyMessage: string,
  source: "file" | "agentBrowser" = "file",
)}
  {#if loading}
    <div class="flex items-center gap-2 py-3 text-sm text-muted-foreground">
      <Spinner class="size-4" />
      <span>Loading skills…</span>
    </div>
  {:else if error}
    <div class="flex flex-wrap items-center justify-between gap-3 py-2">
      <p class="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
    </div>
  {:else if skills.length === 0}
    <p class="py-3 text-sm text-muted-foreground">{emptyMessage}</p>
  {:else}
    <div class="divide-y divide-border">
      {#each skills as skill (skill.filePath)}
        <div
          class="flex items-start justify-between gap-4 py-4 first:pt-1 last:pb-1"
        >
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-medium text-foreground">{skill.name}</h3>
              {#if source === "agentBrowser" && overriddenAgentBrowserNames.has(skill.name)}
                <span
                  class="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  File skill takes precedence
                </span>
              {:else if source === "file" && duplicateNames.has(skill.name)}
                <span
                  class="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  Project overrides global
                </span>
              {/if}
            </div>
            <p class="text-sm text-muted-foreground">{skill.description}</p>
            <p
              class="break-all font-mono text-xs text-muted-foreground"
              title={skill.filePath}
            >
              {skill.filePath}
            </p>
          </div>
          <ToggleSwitch
            checked={source === "agentBrowser"
              ? enabledAgentBrowserSkills.has(skill.name)
              : !disabledSkills.has(skill.name)}
            aria-label={`Enable ${skill.name} skill`}
            onCheckedChange={(checked) =>
              source === "agentBrowser"
                ? setAgentBrowserSkillEnabled(skill.name, checked)
                : setSkillEnabled(skill.name, checked)}
          />
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<SettingsSectionCard
  section="agent-browser-skills"
  title="Agent Browser"
  description="Skills provided by the agent-browser CLI. They are disabled by default and apply to subsequent agent runs."
>
  {@render skillList(
    sortedAgentBrowserSkills,
    "Agent Browser is not available on the daemon PATH, or it provides no skills.",
    "agentBrowser",
  )}
</SettingsSectionCard>

<SettingsSectionCard
  section="global-skills"
  title="Global skills"
  description="Available to every project. Disabling a skill keeps its files in place and applies to subsequent agent runs."
>
  {@render skillList(sortedGlobalSkills, "No global skills were found.")}
</SettingsSectionCard>

{#if activeProject}
  <SettingsSectionCard
    section="project-skills"
    title="Project skills"
    description={`Skills discovered for ${activeProject.name}. Project definitions take precedence over global skills with the same name.`}
  >
    {@render skillList(
      sortedProjectSkills,
      "No skills were found for this project.",
    )}
  </SettingsSectionCard>
{/if}
