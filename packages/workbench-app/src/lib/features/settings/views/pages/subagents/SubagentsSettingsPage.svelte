<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import type { SubagentProfileDiagnostic } from "@nervekit/contracts/subagents";
import Copy from "@lucide/svelte/icons/copy";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Lock from "@lucide/svelte/icons/lock";
import Power from "@lucide/svelte/icons/power";
import Download from "@lucide/svelte/icons/download";
import { SvelteSet } from "svelte/reactivity";
import {
  type SubagentProfileConfiguration,
  type SubagentProfilePatch,
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
  resetSubagentProfile,
  updateSubagentProfile,
  trustSubagentProfile,
} from "../../../api/subagent-profiles.api";
import {
  refreshSubagentProfiles,
  subagentProfilesState,
} from "../../../state/subagent-profiles.svelte";
import {
  ProfileSettingsSession,
  type ProfileSettingsSnapshot,
} from "./subagent-profile-session";
import type { SettingsChange } from "../settings-change";
import { configurableToolOrder } from "../tools/tool-catalog";
import { ensureToolsDraft } from "../tools/tools-draft";
import SubagentProfileDialog from "./SubagentProfileDialog.svelte";
import {
  blankForm,
  formFromProfile,
  formFromConfiguration,
  formToDraft,
  type SubagentProfileForm,
} from "./subagent-profile-form";
import {
  canResetProfileEntry,
  profileSummary,
  profileRowDiagnostics,
  profileDiagnosticSummary,
} from "./subagent-profile-rows";

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
const profileConfiguration = $derived(subagentProfilesState.configuration);
const profiles = $derived(profileConfiguration?.profiles ?? []);
const configurationInvalid = $derived(
  profileConfiguration?.diagnostics.some(
    (item) => item.code === "invalid_document",
  ) ?? false,
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const scopeLabel = $derived(
  projectScope ? ".nerve/config/subagents.json" : "user config/subagents.json",
);
const takenNames = $derived(profiles.map((profile) => profile.name));
let editing = $state<SubagentProfileConfiguration>();
const session = new ProfileSettingsSession();
function isCurrent(snapshot: ProfileSettingsSnapshot): boolean {
  return (
    session.isCurrent(snapshot) &&
    snapshot.target.scope === scope &&
    snapshot.target.projectId === listProjectId
  );
}
let editorSnapshot: ProfileSettingsSnapshot | undefined;
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
  // Availability changes must refresh the host's diagnostics without changing editor snapshots.
  void models;
  void authProviders;
  void skills;
  const target = { scope, projectId: listProjectId };
  if (session.navigate(target)) {
    dialogOpen = false;
    editorSnapshot = undefined;
    busyName = undefined;
    actionError = undefined;
  }
  if (scope === "user" || target.projectId)
    void refreshSubagentProfiles(target.projectId, target.scope);
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

function openEditor(
  form: SubagentProfileForm,
  profile?: SubagentProfileConfiguration,
): void {
  if (busyName !== undefined) return;
  editing = profile;
  editorSnapshot = session.capture(
    { scope, projectId: listProjectId },
    profileConfiguration?.digest ?? null,
  );
  dialogForm = form;
  dialogOpen = true;
}
function add(): void {
  openEditor(blankForm());
}
function edit(profile: SubagentProfileConfiguration): void {
  const form = formFromConfiguration(profile);
  if (form) openEditor(form, profile);
}
function duplicate(profile: SubagentProfileConfiguration): void {
  if (profile.effective)
    openEditor(
      formFromProfile(profile.effective, { duplicate: true, takenNames }),
    );
}
async function save(
  draft: SubagentProfileDraft,
  patch: SubagentProfilePatch,
): Promise<void> {
  const snapshot = editorSnapshot;
  if (!snapshot || !isCurrent(snapshot))
    throw new Error("Settings scope changed. Reopen the profile editor.");
  const { name, ...complete } = draft;
  await updateSubagentProfile({
    ...snapshot.target,
    name,
    expectedDigest: snapshot.digest,
    patch: editing ? patch : { ...complete, tools: complete.tools ?? {} },
  });
  if (!isCurrent(snapshot)) return;
  await refreshSubagentProfiles(
    snapshot.target.projectId,
    snapshot.target.scope,
  );
  if (isCurrent(snapshot)) notify.success(`Saved ${draft.label ?? name}`);
}
async function run(
  name: string,
  action: (snapshot: ProfileSettingsSnapshot) => Promise<unknown>,
): Promise<void> {
  if (busyName !== undefined) return;
  const snapshot = session.capture(
    { scope, projectId: listProjectId },
    profileConfiguration?.digest ?? null,
  );
  busyName = name;
  actionError = undefined;
  try {
    await action(snapshot);
    if (isCurrent(snapshot))
      await refreshSubagentProfiles(
        snapshot.target.projectId,
        snapshot.target.scope,
      );
  } catch (caught) {
    if (isCurrent(snapshot))
      actionError = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (isCurrent(snapshot)) busyName = undefined;
  }
}
function update(
  profile: SubagentProfileConfiguration,
  patch: SubagentProfilePatch,
): void {
  void run(profile.name, (snapshot) =>
    updateSubagentProfile({
      ...snapshot.target,
      name: profile.name,
      expectedDigest: snapshot.digest,
      patch,
    }),
  );
}
function copy(profile: SubagentProfileConfiguration): void {
  if (!profile.effective) return;
  const { name, ...patch } = formToDraft(formFromProfile(profile.effective));
  if (name !== profile.name) return;
  update(profile, { ...patch, tools: patch.tools ?? {} });
}
function remove(profile: SubagentProfileConfiguration): void {
  void run(profile.name, (snapshot) =>
    resetSubagentProfile({
      ...snapshot.target,
      name: profile.name,
      expectedDigest: snapshot.digest,
    }),
  );
}
function trust(profile: SubagentProfileConfiguration): void {
  if (!projectId || !profileConfiguration?.digest) return;
  const digest = profileConfiguration.digest;
  const trustedProjectId = projectId;
  void run(profile.name, () =>
    trustSubagentProfile({ projectId: trustedProjectId, digest }),
  );
}
</script>

{#snippet diagnosticDetails(diagnostic: SubagentProfileDiagnostic)}
  {#if profileDiagnosticSummary(diagnostic) !== diagnostic.message}
    <Collapsible.Root class="min-w-0">
      <Collapsible.Trigger
        class="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          class="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden="true"
        />
        Technical details
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre
          class="mt-1 max-h-40 overflow-auto rounded-sm bg-well p-2 font-mono text-xs whitespace-pre-wrap break-all select-text">{diagnostic.message}</pre>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
{/snippet}

{#if projectScope && !projectId}
  <SettingsEmptyState
    variant="card"
    title="Select a project"
    description="Project profiles are stored in .nerve/config/subagents.json."
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
    {#if projectLocked}
      <SettingsInlineMessage
        tone="warning"
        text="The master switch comes from the separate project capabilities.json. Trust it to apply project capability settings. Profile instructions and permissions require their own subagents.json trust below."
      >
        {#snippet actions()}<Button
            size="xs"
            variant="outline"
            onclick={() => onTrust?.(true)}>Trust project capabilities</Button
          >{/snippet}
      </SettingsInlineMessage>
    {/if}
  {/if}

  {#if profileConfiguration?.trust === "untrusted"}
    <SettingsInlineMessage
      tone="warning"
      text="Editing or resetting one project profile does not approve other entries. Review the whole project subagents.json before choosing Trust project subagents.json."
    />
  {/if}

  <p class="text-xs text-muted-foreground">
    Profile changes apply to newly created sub-agents. Existing sub-agents keep
    their configuration.
  </p>
  {#each profileConfiguration?.diagnostics ?? [] as diagnostic, index (index)}
    <SettingsInlineMessage
      tone={diagnostic.severity === "blocking" ? "destructive" : "warning"}
    >
      <p class="text-xs break-words">{profileDiagnosticSummary(diagnostic)}</p>
      {@render diagnosticDetails(diagnostic)}
    </SettingsInlineMessage>
  {/each}
  <SettingsSection
    id="profiles"
    title="Profiles"
    info="The lead assigns work to sub-agents by profile. Fields inherit from lower scopes unless explicitly pinned."
  >
    {#snippet actions()}
      <Button
        size="xs"
        variant="outline"
        onclick={add}
        disabled={configurationInvalid ||
          busyName !== undefined ||
          !subagentProfilesState.loaded ||
          subagentProfilesState.loading}
      >
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
            onclick={() => void refreshSubagentProfiles(listProjectId, scope)}
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
        {#each profiles as profile (profile.name)}
          {@const effective = profile.effective}
          {@const busy =
            busyName !== undefined ||
            subagentProfilesState.loading ||
            configurationInvalid}
          {@const rowDiagnostics = profileRowDiagnostics(
            profile,
            profileConfiguration?.diagnostics ?? [],
            scope,
          )}
          {@const blocked = rowDiagnostics.diagnostics.some(
            (item) => item.severity === "blocking",
          )}
          <SettingsListItem
            title={effective?.label ?? profile.name}
            description={effective?.description}
          >
            {#snippet detail()}
              <span>{profile.name}</span>
              {#if effective}<span>· {profileSummary(effective, models)}</span
                >{/if}
            {/snippet}
            {#snippet status()}
              <Badge variant="neutral"
                >{profile.local ? scope : "Inherited"}</Badge
              >
              {#if rowDiagnostics.documentBlock}<Badge variant="destructive"
                  >Configuration blocked</Badge
                >{/if}
              {#if blocked}<Badge variant="destructive">Profile blocked</Badge>
              {:else if rowDiagnostics.diagnostics.length && !rowDiagnostics.documentBlock}<Badge
                  variant="warning">Usable with reduced capabilities</Badge
                >{/if}
              {#if effective}<Badge variant="neutral"
                  >{effective.enabled ? "Enabled" : "Disabled"}</Badge
                >{/if}
            {/snippet}
            {#snippet supporting()}
              <div class="grid min-w-0 gap-1">
                {#if rowDiagnostics.documentBlock}
                  <p class="text-xs text-destructive break-words">
                    {rowDiagnostics.documentBlock}
                  </p>
                {/if}
                {#each rowDiagnostics.diagnostics as diagnostic, index (index)}
                  <div class="min-w-0">
                    <p
                      class={diagnostic.severity === "blocking"
                        ? "text-xs text-destructive whitespace-pre-wrap break-words"
                        : "text-xs text-warning whitespace-pre-wrap break-words"}
                    >
                      {profileDiagnosticSummary(diagnostic)}
                    </p>
                    {@render diagnosticDetails(diagnostic)}
                  </div>
                {/each}
              </div>
            {/snippet}
            {#snippet actions()}
              {#if profile.trust === "untrusted"}
                <IconAction
                  icon={Lock}
                  label="Trust project subagents.json"
                  disabled={busy}
                  onclick={() => trust(profile)}
                />
              {/if}
              {#if effective || profile.local !== null}
                <IconAction
                  icon={Pencil}
                  label={`Edit ${profile.name}`}
                  disabled={busy}
                  onclick={() => edit(profile)}
                />
              {/if}
              {#if effective}
                <IconAction
                  icon={Power}
                  label={`${effective.enabled ? "Disable" : "Enable"} ${profile.name} in ${scope} scope`}
                  disabled={busy}
                  onclick={() =>
                    update(profile, { enabled: !effective.enabled })}
                />
                <IconAction
                  icon={Download}
                  label={`Copy ${profile.name} to ${scope} scope`}
                  disabled={busy}
                  onclick={() => copy(profile)}
                />
                <IconAction
                  icon={Copy}
                  label={`Duplicate ${profile.name}`}
                  disabled={busy}
                  onclick={() => duplicate(profile)}
                />
              {/if}
              {#if canResetProfileEntry(profile, scope)}
                <IconAction
                  icon={RotateCcw}
                  label={`Reset local entry ${profile.name}`}
                  disabled={busy}
                  onclick={() => remove(profile)}
                />
              {/if}
            {/snippet}
          </SettingsListItem>
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
    configuration={editing}
    {scopeLabel}
    models={usableModels}
    {skills}
    {takenNames}
    onSave={save}
  />
{/if}
