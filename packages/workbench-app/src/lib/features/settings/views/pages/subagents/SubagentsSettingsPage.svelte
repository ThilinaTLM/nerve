<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { SvelteSet } from "svelte/reactivity";
import {
  builtInSubagentProfiles,
  type SubagentProfile,
  type SubagentProfileDraft,
} from "@nervekit/contracts/subagents";
import { subagentToolNames } from "@nervekit/contracts/tools";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type {
  AuthProviderMetadata,
  AvailableSkill,
  ModelInfo,
  Settings,
} from "$lib/api";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  capabilityResetPatch,
  capabilityTogglePatch,
  capabilityToolState,
} from "$lib/presentation/composer/capability-origin";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsListItem,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import {
  deleteSubagentProfile,
  saveSubagentProfile,
  setSubagentProfileEnabled,
  trustSubagentProfile,
} from "../../../api/subagent-profiles.api";
import {
  refreshSubagentProfiles,
  subagentProfilesState,
} from "../../../state/subagent-profiles.svelte";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import type { SettingsChange } from "../settings-change";
import { configurableToolOrder } from "../tools/tool-catalog";
import { ensureToolsDraft } from "../tools/tools-draft";
import SubagentProfileDialog from "./SubagentProfileDialog.svelte";
import {
  blankForm,
  formFromProfile,
  type SubagentProfileForm,
} from "./subagent-profile-form";
import { profileRowState, profileSummary } from "./subagent-profile-rows";

type Props = {
  scope: "user" | "project";
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  skills?: AvailableSkill[];
  onSettingsChange?: SettingsChange;
  /** The active project, for project scope. */
  projectId?: string;
  projectName?: string;
  configuration?: CapabilityConfiguration;
  loading?: boolean;
  error?: string;
  onPatch?: (patch: CapabilityPatch) => void;
  onTrust?: (trusted: boolean) => void;
  onRetry?: () => void;
};

let {
  scope,
  settingsDraft,
  models = [],
  authProviders = [],
  skills = [],
  onSettingsChange,
  projectId,
  projectName,
  configuration,
  loading = false,
  error,
  onPatch,
  onTrust,
  onRetry,
}: Props = $props();

const projectScope = $derived(scope === "project");
const listProjectId = $derived(projectScope ? projectId : undefined);
const profiles = $derived(subagentProfilesState.profiles);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const scopeLabel = $derived(
  projectScope ? ".nerve/subagents in this project" : "~/.nerve/subagents",
);
const builtInNames = new Set(builtInSubagentProfiles.map((item) => item.name));
const takenNames = $derived(
  profiles
    .filter((profile) => profile.source === scope)
    .map((profile) => profile.name),
);

let dialogOpen = $state(false);
let dialogForm = $state<SubagentProfileForm>(blankForm());
let busyName = $state<string>();
let actionError = $state<string>();

$effect(() => {
  subagentProfilesState.watching = true;
  return () => {
    subagentProfilesState.watching = false;
  };
});
$effect(() => {
  void refreshSubagentProfiles(listProjectId);
});

// Master switch. User scope stores the group's tools in the disabled list;
// project scope pins the `subagents` capability for the project.
const disabledTools = $derived(new Set(settingsDraft.tools?.disabled ?? []));
const userEnabled = $derived(
  subagentToolNames.every((name) => !disabledTools.has(name)),
);
const projectState = $derived(
  configuration
    ? capabilityToolState({
        configuration,
        level: "project",
        names: ["subagents"],
      })
    : undefined,
);
const projectLocked = $derived(
  configuration?.trust.status === "untrusted" ||
    configuration?.trust.status === "invalid",
);

function setUserEnabled(enabled: boolean): void {
  const tools = ensureToolsDraft(settingsDraft);
  const next = new SvelteSet(tools.disabled);
  for (const name of subagentToolNames) {
    if (enabled) next.delete(name);
    else next.add(name);
  }
  const disabled = configurableToolOrder.filter((name) => next.has(name));
  tools.disabled = disabled;
  onSettingsChange?.({ tools: { disabled } }, { immediate: true });
}

function setProjectEnabled(enabled: boolean): void {
  if (!projectState) return;
  onPatch?.({
    tools: capabilityTogglePatch(projectState, ["subagents"], enabled),
  });
}

function openEditor(form: SubagentProfileForm): void {
  dialogForm = form;
  dialogOpen = true;
}

function add(): void {
  openEditor(blankForm());
}

function edit(profile: SubagentProfile): void {
  openEditor(formFromProfile(profile));
}

function duplicate(profile: SubagentProfile): void {
  openEditor(formFromProfile(profile, { duplicate: true, takenNames }));
}

async function save(draft: SubagentProfileDraft): Promise<void> {
  await saveSubagentProfile({
    scope,
    projectId: projectScope ? projectId : undefined,
    profile: draft,
  });
  await refreshSubagentProfiles(listProjectId);
  notify.success(`Saved ${draft.label ?? draft.name}`);
}

async function run(name: string, action: () => Promise<void>): Promise<void> {
  busyName = name;
  actionError = undefined;
  try {
    await action();
    await refreshSubagentProfiles(listProjectId);
  } catch (caught) {
    actionError = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busyName = undefined;
  }
}

function setEnabled(profile: SubagentProfile, enabled: boolean): void {
  void run(profile.name, () =>
    setSubagentProfileEnabled(profile.name, enabled),
  );
}

function remove(profile: SubagentProfile): void {
  void run(profile.name, async () => {
    await deleteSubagentProfile({
      scope,
      projectId: projectScope ? projectId : undefined,
      name: profile.name,
    });
    notify.success(
      builtInNames.has(profile.name)
        ? `Reset ${profile.label} to the built-in profile`
        : `Deleted ${profile.label}`,
    );
  });
}

function trust(profile: SubagentProfile): void {
  if (!projectId || !profile.digest) return;
  const digest = profile.digest;
  void run(profile.name, async () => {
    await trustSubagentProfile({ projectId, name: profile.name, digest });
  });
}
</script>

{#if projectScope && !projectId}
  <SettingsEmptyState
    variant="card"
    title="Select a project"
    description="Project sub-agent profiles are stored in the project's .nerve/subagents folder."
  />
{:else}
  {#if error}
    <SettingsInlineMessage tone="destructive" text={error}>
      {#snippet actions()}
        <Button size="xs" variant="outline" onclick={() => onRetry?.()}
          >Retry</Button
        >
      {/snippet}
    </SettingsInlineMessage>
  {/if}
  {#if projectScope && configuration}
    <ProjectCapabilityTrustNotice trust={configuration.trust} {onTrust} />
  {/if}

  <SettingsSection
    id="profiles"
    title="Profiles"
    info="The lead assigns work to sub-agents by profile. A project profile replaces a user or built-in profile with the same name."
  >
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={add}>
        <Plus class="size-3.5" aria-hidden="true" />Add profile
      </Button>
    {/snippet}

    <SettingsGroup>
      {#if projectScope}
        {#if projectState}
          <SettingsToggleRow
            label="Sub-agents"
            description={projectState.originLabel}
            checked={projectState.enabled}
            disabled={projectLocked || loading}
            onCheckedChange={setProjectEnabled}
          >
            {#snippet badges()}
              {#if projectState.stored}
                <Badge variant="neutral">Project</Badge>
                <IconAction
                  icon={RotateCcw}
                  label="Reset sub-agents to your user setting"
                  onclick={() => onPatch?.(capabilityResetPatch(["subagents"]))}
                />
              {/if}
            {/snippet}
          </SettingsToggleRow>
        {:else}
          <Skeleton class="h-10 w-full" />
        {/if}
      {:else}
        <SettingsToggleRow
          label="Sub-agents"
          description="Let agents delegate work to sub-agents. When off, the lead has no sub-agent tools."
          checked={userEnabled}
          onCheckedChange={setUserEnabled}
        />
      {/if}
    </SettingsGroup>

    {#if actionError}
      <SettingsInlineMessage tone="destructive" text={actionError} />
    {/if}
    {#if subagentProfilesState.error}
      <SettingsInlineMessage
        tone="destructive"
        text={subagentProfilesState.error}
      >
        {#snippet actions()}
          <Button
            size="xs"
            variant="outline"
            onclick={() => void refreshSubagentProfiles(listProjectId)}
            >Retry</Button
          >
        {/snippet}
      </SettingsInlineMessage>
    {/if}

    {#if !subagentProfilesState.loaded}
      <div class="grid gap-1.5">
        <Skeleton class="h-9 w-full" />
        <Skeleton class="h-9 w-full" />
      </div>
    {:else}
      <SettingsList ariaLabel="Sub-agent profiles">
        {#each profiles as profile (`${profile.source}:${profile.name}`)}
          {@const row = profileRowState(profile, scope, builtInNames)}
          {@const busy = busyName === profile.name}
          <SettingsListItem
            title={profile.label}
            description={profile.description || undefined}
            class={profile.shadowed || profile.error ? "opacity-80" : undefined}
          >
            {#snippet detail()}
              <span class="font-mono">{profile.name}</span>
              {#if !profile.error}
                <span>· {profileSummary(profile, models)}</span>
              {/if}
            {/snippet}
            {#snippet status()}
              <Badge variant="neutral">{row.sourceLabel}</Badge>
              {#if profile.shadowed}
                <Badge variant="warning">Shadowed</Badge>
              {/if}
              {#if profile.error}
                <Badge variant="destructive" title={profile.error}
                  >Invalid</Badge
                >
              {/if}
              {#if profile.trust === "untrusted"}
                <Badge variant="warning">Untrusted</Badge>
              {/if}
            {/snippet}
            {#snippet actions()}
              {#if row.canTrust}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || !profile.digest}
                  onclick={() => trust(profile)}>Trust</Button
                >
              {/if}
              {#if row.canEnable}
                <Switch
                  size="settings"
                  checked={profile.enabled}
                  disabled={busy}
                  aria-label={`Enable ${profile.label}`}
                  onCheckedChange={(checked) => setEnabled(profile, checked)}
                />
              {/if}
              {#if row.canEdit}
                <IconAction
                  icon={Pencil}
                  label={`Edit ${profile.label}`}
                  onclick={() => edit(profile)}
                />
              {/if}
              {#if row.canDuplicate}
                <IconAction
                  icon={Copy}
                  label={`Duplicate ${profile.label}`}
                  onclick={() => duplicate(profile)}
                />
              {/if}
              {#if row.remove}
                <IconAction
                  icon={row.remove === "reset" ? RotateCcw : Trash2}
                  label={`${row.remove === "reset" ? "Reset" : "Delete"} ${profile.label}`}
                  disabled={busy}
                  onclick={() => remove(profile)}
                />
              {/if}
            {/snippet}
          </SettingsListItem>
        {:else}
          <SettingsEmptyState title="No sub-agent profiles" />
        {/each}
      </SettingsList>
      {#if projectScope && projectName}
        <p class="text-xs text-muted-foreground">
          Showing profiles available in {projectName}.
        </p>
      {/if}
    {/if}
  </SettingsSection>

  <SubagentProfileDialog
    bind:open={dialogOpen}
    initial={dialogForm}
    {scopeLabel}
    models={usableModels}
    {skills}
    {takenNames}
    onSave={save}
  />
{/if}
