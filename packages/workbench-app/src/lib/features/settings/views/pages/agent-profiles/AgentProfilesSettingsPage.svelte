<script lang="ts">
import { untrack } from "svelte";
import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { ProjectSettingsState } from "../../../state/project-settings.svelte";
import FileBraces from "@lucide/svelte/icons/file-braces";
import Plus from "@lucide/svelte/icons/plus";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import { SvelteSet } from "svelte/reactivity";
import type {
  AgentProfileConfiguration,
  AgentProfileDraft,
  AgentProfilePatch,
} from "@nervekit/contracts/agent-profiles";
import { subagentToolNames } from "@nervekit/contracts/tools";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import {
  capabilityToolEnabled,
  type CapabilityConfiguration,
  type CapabilityPatch,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
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
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import {
  profileLabel,
  profileOriginLayer,
} from "$lib/presentation/agent-profiles/profile-layers";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import {
  readAgentProfiles,
  resetAgentProfile,
  trustAgentProfile,
  updateAgentProfile,
} from "../../../api/agent-profiles.api";
import {
  refreshAgentProfiles,
  agentProfilesState,
} from "../../../state/agent-profiles.svelte";
import type { SettingsChange } from "../settings-change";
import { configurableToolOrder } from "../tools/tool-catalog";
import { ensureToolsDraft } from "../tools/tools-draft";
import NewProfileDialog from "./NewProfileDialog.svelte";
import ProfileDiagnosticMessage from "./ProfileDiagnosticMessage.svelte";
import ProjectTrustReviewDialog from "./ProjectTrustReviewDialog.svelte";
import AgentProfileEditor from "./AgentProfileEditor.svelte";
import AgentProfileRow from "./AgentProfileRow.svelte";
import {
  blankForm,
  formFromConfiguration,
  formFromProfile,
  formToDraft,
  type AgentProfileForm,
} from "./agent-profile-form";
import {
  groupProfilesByOrigin,
  profileDeleteConfirmation,
  profileMatchesFilter,
  profileResetConfirmation,
  profileRowActions,
  profileRowSummary,
  type ProfileLeadContext,
  type ProfileSettingsLayer,
} from "./agent-profile-rows";
import {
  ProfileSettingsSession,
  type ProfileSettingsSnapshot,
} from "./agent-profile-session";

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
  /** Opens a project-relative file in the workbench file viewer. */
  onOpenFile?: (path: string) => void;
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
  onOpenFile,
}: Props = $props();

const userFilePath = "~/.nerve/config/agent-profiles.json";
const projectFilePath = ".nerve/config/agent-profiles.json";
/** The filter appears only once the list is long enough to need it. */
const filterThreshold = 6;

const projectScope = $derived(scope === "project");
const listProjectId = $derived(projectScope ? projectId : undefined);
const scopeName = $derived(projectScope ? (projectName ?? "Project") : "User");
const filePath = $derived(projectScope ? projectFilePath : userFilePath);
const profileConfiguration = $derived(agentProfilesState.configuration);
const profiles = $derived(profileConfiguration?.profiles ?? []);
const documentDiagnostics = $derived(profileConfiguration?.diagnostics ?? []);
const configurationInvalid = $derived(
  documentDiagnostics.some((item) => item.code === "invalid_document"),
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const permissionRuleSets = $derived(
  permissionRuleSetCatalog.summaries(projectId),
);
const takenNames = $derived(profiles.map((profile) => profile.name));
/** The loaded document belongs to the page's current target. */
const loadedHere = $derived(
  agentProfilesState.loaded &&
    agentProfilesState.scope === scope &&
    agentProfilesState.projectId === listProjectId,
);

type EditorView = {
  kind: "editor";
  mode: "create" | "edit";
  initial: AgentProfileForm;
  configuration?: AgentProfileConfiguration;
  snapshot: ProfileSettingsSnapshot;
};
let view = $state.raw<{ kind: "list" } | EditorView>({ kind: "list" });
let saving = $state(false);
let busyName = $state<string>();
let actionError = $state<string>();
let filter = $state("");
let newProfileOpen = $state(false);
let trustReviewOpen = $state(false);
let confirmOpen = $state(false);
let confirmation = $state.raw<{
  kind: "reset" | "delete";
  profile: AgentProfileConfiguration;
  fromEditor: boolean;
}>();

const session = new ProfileSettingsSession();
function isCurrent(snapshot: ProfileSettingsSnapshot): boolean {
  return (
    session.isCurrent(snapshot) &&
    snapshot.target.scope === scope &&
    snapshot.target.projectId === listProjectId
  );
}

$effect(() => {
  agentProfilesState.watching = true;
  return () => {
    agentProfilesState.watching = false;
  };
});
$effect(() => {
  // Availability changes must refresh the host's diagnostics without changing editor snapshots.
  void models;
  void authProviders;
  void skills;
  const target = { scope, projectId: listProjectId };
  if (session.navigate(target)) {
    view = { kind: "list" };
    confirmOpen = false;
    newProfileOpen = false;
    trustReviewOpen = false;
    filter = "";
    busyName = undefined;
    actionError = undefined;
  }
  if (scope === "user" || target.projectId)
    void refreshAgentProfiles(target.projectId, target.scope);
});
$effect(() => {
  if (projectId) void permissionRuleSetCatalog.ensure(projectId);
});

const DEFAULT_PROFILE: string = DEFAULT_AGENT_PROFILE;
const leadProfiles = $derived(
  profiles.flatMap((profile) =>
    profile.effective?.enabled &&
    !profile.effective.error &&
    profile.effective.usableBy !== "subagent"
      ? [{ value: profile.name, label: profileLabel(profile) }]
      : [],
  ),
);
const projectHarness = new ProjectSettingsState();
$effect(() => {
  const id = projectScope ? projectId : undefined;
  untrack(() => void projectHarness.load(id));
  if (!id) return;
  const refresh = () => void projectHarness.load(id);
  const disposers = [
    onAnyEvent((event) => {
      if (
        event.type === "settings.updated" ||
        ((event.type === "projectSettings.changed" ||
          event.type === "filesystem.project.changed") &&
          event.data.projectId === id)
      )
        refresh();
    }),
    onWorkbenchReconnect(refresh),
  ];
  return () => disposers.forEach((dispose) => dispose());
});
const defaultProfile = $derived(
  projectScope
    ? (projectHarness.result?.overrides.defaultAgentProfile ?? "__inherit__")
    : (settingsDraft.defaultAgentProfile ?? "__built_in__"),
);
const defaultProfileItems = $derived([
  projectScope
    ? {
        value: "__inherit__",
        label: `Inherit user default (${projectHarness.result?.inherited.defaultAgentProfile ?? DEFAULT_PROFILE})`,
      }
    : { value: "__built_in__", label: "Built-in default (Coding)" },
  ...(defaultProfile === "__built_in__" ||
  defaultProfile === "__inherit__" ||
  leadProfiles.some((item) => item.value === defaultProfile)
    ? leadProfiles
    : [...leadProfiles, { value: defaultProfile, label: defaultProfile }]),
]);

function setDefaultProfile(name: string): void {
  if (projectScope) {
    void projectHarness.update({
      defaultAgentProfile: name === "__inherit__" ? null : name,
    });
    return;
  }
  const profile = name === "__built_in__" ? null : name;
  settingsDraft.defaultAgentProfile = profile ?? undefined;
  onSettingsChange?.({ defaultAgentProfile: profile }, { immediate: true });
}

// Delegation. User scope stores the group's tools in the disabled list;
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
const delegationEnabled = $derived(
  projectScope ? (projectState?.enabled ?? true) : userEnabled,
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

const lead = $derived<ProfileLeadContext>({
  models: usableModels,
  leadTool: (name: CapabilityToolName) =>
    projectScope && configuration
      ? capabilityToolEnabled(configuration.effective, name)
      : !(disabledTools as ReadonlySet<string>).has(name),
  leadSkills: skills.map((skill) => skill.name),
});

const groups = $derived(
  groupProfilesByOrigin(
    profiles.filter((profile) => profileMatchesFilter(profile, filter)),
    scope,
  ),
);
const noProjectProfiles = $derived(
  projectScope &&
    !profiles.some(
      (profile) => profileOriginLayer(profile, scope) === "project",
    ),
);
const listBusy = $derived(
  busyName !== undefined || agentProfilesState.loading || configurationInvalid,
);
const canCreate = $derived(
  !configurationInvalid &&
    busyName === undefined &&
    loadedHere &&
    !agentProfilesState.loading,
);

function openEditor(
  mode: "create" | "edit",
  initial: AgentProfileForm,
  profile?: AgentProfileConfiguration,
): void {
  if (busyName !== undefined) return;
  view = {
    kind: "editor",
    mode,
    initial,
    ...(profile ? { configuration: profile } : {}),
    snapshot: session.capture(
      { scope, projectId: listProjectId },
      profileConfiguration?.digest ?? null,
    ),
  };
}
function edit(profile: AgentProfileConfiguration): void {
  const form = formFromConfiguration(profile);
  if (form) openEditor("edit", form, profile);
}
function duplicate(profile: AgentProfileConfiguration): void {
  if (profile.effective)
    openEditor(
      "create",
      formFromProfile(profile.effective, { duplicate: true, takenNames }),
    );
}
function startNew(source: AgentProfileConfiguration | undefined): void {
  if (source) duplicate(source);
  else openEditor("create", blankForm());
}
function editExisting(name: string): void {
  const profile = profiles.find((item) => item.name === name);
  if (profile) edit(profile);
}

const editorConflict = $derived(
  view.kind === "editor" &&
    !saving &&
    loadedHere &&
    (profileConfiguration?.digest ?? null) !== view.snapshot.digest,
);

async function save(
  draft: AgentProfileDraft,
  patch: AgentProfilePatch,
): Promise<void> {
  const editor = view;
  if (editor.kind !== "editor" || !isCurrent(editor.snapshot))
    throw new Error("Settings scope changed. Reopen the profile editor.");
  const snapshot = editor.snapshot;
  const { name, ...complete } = draft;
  saving = true;
  try {
    await updateAgentProfile({
      ...snapshot.target,
      name,
      expectedDigest: snapshot.digest,
      patch:
        editor.mode === "edit"
          ? patch
          : { ...complete, tools: complete.tools ?? {} },
    });
    if (!isCurrent(snapshot)) return;
    await refreshAgentProfiles(
      snapshot.target.projectId,
      snapshot.target.scope,
    );
    if (!isCurrent(snapshot)) return;
    notify.success(`Saved ${draft.label ?? name}`);
    if (view === editor) view = { kind: "list" };
  } finally {
    saving = false;
  }
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
      await refreshAgentProfiles(
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
function setEnabled(
  profile: AgentProfileConfiguration,
  enabled: boolean,
): void {
  void run(profile.name, (snapshot) =>
    updateAgentProfile({
      ...snapshot.target,
      name: profile.name,
      expectedDigest: snapshot.digest,
      patch: { enabled },
    }),
  );
}
function profileDraft(
  profile: AgentProfileConfiguration,
): AgentProfileDraft | undefined {
  return profile.effective
    ? formToDraft(formFromProfile(profile.effective))
    : undefined;
}
/** Writes the whole resolved profile into the other settings layer. */
function copyTo(
  profile: AgentProfileConfiguration,
  target: ProfileSettingsLayer,
): void {
  const draft = profileDraft(profile);
  const targetProjectId = target === "project" ? projectId : undefined;
  if (!draft || (target === "project" && !targetProjectId)) return;
  const { name, ...complete } = draft;
  const label = profileLabel(profile);
  const targetName = target === "project" ? (projectName ?? "project") : "User";
  void run(profile.name, async (snapshot) => {
    const destination = { scope: target, projectId: targetProjectId };
    const current = await readAgentProfiles(destination);
    await updateAgentProfile({
      ...destination,
      name,
      expectedDigest: current.digest,
      patch: { ...complete, tools: complete.tools ?? {} },
    });
    if (isCurrent(snapshot)) notify.success(`Copied ${label} to ${targetName}`);
  });
}
async function exportJson(profile: AgentProfileConfiguration): Promise<void> {
  const draft = profileDraft(profile);
  if (!draft) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
    notify.success(`Copied ${profileLabel(profile)} as JSON`);
  } catch {
    notify.error("Could not copy to the clipboard");
  }
}
function confirmRemoval(
  kind: "reset" | "delete",
  profile: AgentProfileConfiguration,
  fromEditor = false,
): void {
  confirmation = { kind, profile, fromEditor };
  confirmOpen = true;
}
const confirmCopy = $derived.by(() => {
  if (!confirmation) return undefined;
  const { kind, profile } = confirmation;
  if (kind === "delete")
    return {
      ...profileDeleteConfirmation(profile, scope, filePath),
      confirmLabel: "Delete profile",
    };
  return profileResetConfirmation(profile, scope, usableModels);
});
function remove(): void {
  const pending = confirmation;
  if (!pending) return;
  if (pending.fromEditor) view = { kind: "list" };
  void run(pending.profile.name, (snapshot) =>
    resetAgentProfile({
      ...snapshot.target,
      name: pending.profile.name,
      expectedDigest: snapshot.digest,
    }),
  );
}
function trustProject(): void {
  if (!projectId || !profileConfiguration?.digest) return;
  const digest = profileConfiguration.digest;
  const trustedProjectId = projectId;
  trustReviewOpen = false;
  void run("", () =>
    trustAgentProfile({ projectId: trustedProjectId, digest }),
  );
}
</script>

{#snippet delegation()}
  <SettingsSection id="delegation" title="Delegation">
    {#if projectScope && projectLocked}
      <SettingsInlineMessage
        tone="warning"
        text="Project delegation comes from .nerve/config/capabilities.json, which isn't trusted yet."
      >
        {#snippet actions()}<Button
            size="sm"
            variant="outline"
            onclick={() => onTrust?.(true)}>Trust capabilities</Button
          >{/snippet}
      </SettingsInlineMessage>
    {/if}
    <SettingsGroup>
      {#if projectScope}
        {#if projectState}
          <SettingsToggleRow
            label="Let the main agent delegate"
            description={`${projectState.originLabel}.`}
            checked={projectState.enabled}
            disabled={projectLocked || loading}
            onCheckedChange={setProjectEnabled}
          >
            {#snippet badges()}
              {#if projectState.stored}
                <Badge variant="neutral">Project</Badge>
                <IconAction
                  icon={RotateCcw}
                  label="Reset delegation to your user setting"
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
          label="Let the main agent delegate"
          description="When off, the main agent has no sub-agent tools and sub-agent profiles aren't offered."
          checked={userEnabled}
          onCheckedChange={setUserEnabled}
        />
      {/if}
    </SettingsGroup>
    {#if !delegationEnabled}
      <SettingsInlineMessage
        tone="info"
        text="Sub-agent profiles stay editable, but agents can't delegate to them while delegation is off."
      />
    {/if}
  </SettingsSection>
{/snippet}

{#snippet defaultProfileSection()}
  {#if !projectScope || projectId}
    <SettingsSection
      id="default-profile"
      title="Default profile"
      info="New conversations start with this profile, and plan approval returns to it."
    >
      <SettingsGroup>
        <SettingsRow label="Default profile" layout="responsive">
          {#snippet control()}
            <SelectField
              items={defaultProfileItems}
              value={defaultProfile}
              ariaLabel="Default profile"
              class="sm:w-72"
              disabled={!loadedHere ||
                (projectScope &&
                  (!projectHarness.result ||
                    projectHarness.loading ||
                    projectHarness.saving))}
              onValueChange={setDefaultProfile}
            />
          {/snippet}
        </SettingsRow>
      </SettingsGroup>
      {#if projectScope && projectHarness.error}
        <SettingsInlineMessage tone="destructive" text={projectHarness.error}>
          {#snippet actions()}
            <Button
              size="sm"
              variant="outline"
              onclick={() => void projectHarness.load(projectId)}
            >
              Retry
            </Button>
          {/snippet}
        </SettingsInlineMessage>
      {/if}
    </SettingsSection>
  {/if}
{/snippet}

{#if projectScope && !projectId}
  <SettingsEmptyState
    variant="card"
    title="Select a project"
    description="Project profiles are stored in .nerve/config/agent-profiles.json."
  />
{:else if view.kind === "editor"}
  {@const editor = view}
  {@const profile = editor.configuration}
  {@const actions = profile
    ? profileRowActions(profile, scope, { canCopyToProject: false })
    : undefined}
  <AgentProfileEditor
    mode={editor.mode}
    {permissionRuleSets}
    initial={editor.initial}
    configuration={profile}
    {scope}
    {filePath}
    models={usableModels}
    {skills}
    {takenNames}
    conflict={editorConflict}
    onSave={save}
    onBack={() => (view = { kind: "list" })}
    onEditExisting={editExisting}
    onDuplicate={profile && actions?.duplicate
      ? () => duplicate(profile)
      : undefined}
    onResetCustomizations={profile && actions?.resetCustomizations
      ? () => confirmRemoval("reset", profile, true)
      : undefined}
    onDelete={profile && actions?.delete
      ? () => confirmRemoval("delete", profile, true)
      : undefined}
  />
{:else}
  {#if error}
    <SettingsInlineMessage tone="destructive" text={error}>
      {#snippet actions()}
        <Button size="sm" variant="outline" onclick={() => onRetry?.()}
          >Retry</Button
        >
      {/snippet}
    </SettingsInlineMessage>
  {/if}
  {@render defaultProfileSection()}
  {@render delegation()}

  {#if projectScope && profileConfiguration?.trust === "untrusted"}
    <SettingsInlineMessage tone="warning">
      <p class="text-xs font-medium">Review this project's agent profiles</p>
      <p class="text-xs">
        Until you review .nerve/config/agent-profiles.json, its instructions and
        permissions are ignored and the profiles that depend on them can't be
        used. Editing one profile here doesn't approve the rest of the file.
      </p>
      {#snippet actions()}
        <Button
          size="sm"
          variant="outline"
          disabled={busyName !== undefined || !profileConfiguration?.digest}
          onclick={() => (trustReviewOpen = true)}>Review</Button
        >
      {/snippet}
    </SettingsInlineMessage>
  {/if}

  {#each documentDiagnostics as diagnostic, index (index)}
    <SettingsInlineMessage
      tone={diagnostic.severity === "blocking" ? "destructive" : "warning"}
    >
      <ProfileDiagnosticMessage {diagnostic} />
    </SettingsInlineMessage>
  {/each}

  <SettingsSection id="profiles" title="Profiles">
    {#snippet actions()}
      {#if loadedHere}
        <span class="text-xs text-muted-foreground">{profiles.length}</span>
      {/if}
      {#if profiles.length > filterThreshold}
        <SearchInput
          bind:value={filter}
          placeholder="Filter profiles"
          ariaLabel="Filter profiles"
          class="w-44"
        />
      {/if}
      {#if projectScope && onOpenFile}
        <IconAction
          icon={FileBraces}
          label={profileConfiguration?.digest
            ? `Open ${projectFilePath}`
            : `${projectFilePath} doesn't exist yet; it's created when you save a project change`}
          disabled={!profileConfiguration?.digest}
          onclick={() => onOpenFile?.(projectFilePath)}
        />
      {/if}
      <Button
        size="sm"
        variant="outline"
        onclick={() => (newProfileOpen = true)}
        disabled={!canCreate}
      >
        <Plus class="size-3.5" aria-hidden="true" />New profile
      </Button>
    {/snippet}

    {#if actionError}
      <SettingsInlineMessage tone="destructive" text={actionError} />
    {/if}
    {#if agentProfilesState.error}
      <SettingsInlineMessage tone="destructive" text={agentProfilesState.error}>
        {#snippet actions()}
          <Button
            size="sm"
            variant="outline"
            onclick={() => void refreshAgentProfiles(listProjectId, scope)}
            >Retry</Button
          >
        {/snippet}
      </SettingsInlineMessage>
    {/if}

    {#if !agentProfilesState.loaded}
      <div class="grid gap-1.5">
        <Skeleton class="h-9 w-full" />
        <Skeleton class="h-9 w-full" />
      </div>
    {:else}
      <div class="grid gap-3">
        {#if noProjectProfiles && !filter}
          <SettingsEmptyState
            variant="card"
            title="No project-specific profiles yet"
            description="The profiles below come from User and Built-in. Customize one for this repo, or create a profile the whole team can use."
          >
            {#snippet actions()}
              <Button
                size="sm"
                variant="outline"
                disabled={!canCreate}
                onclick={() => (newProfileOpen = true)}
              >
                <Plus class="size-3.5" aria-hidden="true" />New project profile
              </Button>
            {/snippet}
          </SettingsEmptyState>
        {/if}
        {#each groups as group (group.origin)}
          <SettingsGroup title={group.title}>
            <SettingsList ariaLabel={group.title}>
              {#each group.profiles as profile (profile.name)}
                <AgentProfileRow
                  {profile}
                  {scope}
                  summary={profile.effective
                    ? profileRowSummary(profile.effective, lead).join(" · ")
                    : undefined}
                  {documentDiagnostics}
                  busy={listBusy}
                  canCopyToProject={!!projectId}
                  onOpen={() => edit(profile)}
                  onEnabledChange={(enabled) => setEnabled(profile, enabled)}
                  onDuplicate={() => duplicate(profile)}
                  onCopy={(target) => copyTo(profile, target)}
                  onExport={() => void exportJson(profile)}
                  onResetCustomizations={() => confirmRemoval("reset", profile)}
                  onDelete={() => confirmRemoval("delete", profile)}
                />
              {/each}
            </SettingsList>
          </SettingsGroup>
        {:else}
          {#if filter}
            <p class="text-xs text-muted-foreground">
              No profiles match “{filter}”.
            </p>
          {/if}
        {/each}
      </div>
      {#if projectScope}
        <p class="text-xs text-muted-foreground">
          Commit <span class="font-mono">{projectFilePath}</span> to share these profiles.
          Teammates are asked to review them before they apply.
        </p>
      {/if}
    {/if}
  </SettingsSection>
{/if}

<NewProfileDialog
  bind:open={newProfileOpen}
  {scope}
  {scopeName}
  {profiles}
  onContinue={startNew}
/>
{#if profileConfiguration && projectScope}
  <ProjectTrustReviewDialog
    bind:open={trustReviewOpen}
    configuration={profileConfiguration}
    models={usableModels}
    busy={busyName !== undefined}
    onTrust={trustProject}
  />
{/if}
{#if confirmCopy}
  <ConfirmDialog
    bind:open={confirmOpen}
    title={confirmCopy.title}
    description={confirmCopy.description}
    confirmLabel={confirmCopy.confirmLabel}
    destructive={confirmation?.kind === "delete"}
    onConfirm={remove}
  />
{/if}
