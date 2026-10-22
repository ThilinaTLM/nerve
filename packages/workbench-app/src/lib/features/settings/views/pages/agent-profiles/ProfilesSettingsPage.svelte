<!--
  Profiles are templates. Applying one writes its values into a conversation;
  later edits only affect the next apply. Each profile is one JSON file with
  its own digest and (in projects) its own trust.
-->
<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import Lock from "@lucide/svelte/icons/lock";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import {
  DEFAULT_AGENT_PROFILE,
  agentProfileDraftSchema,
  type AgentProfileConfiguration,
  type AgentProfileDraft,
  type AgentProfilePatch,
  type AgentProfilesConfiguration,
  type AgentProfileUsableBy,
} from "@nervekit/contracts/agent-profiles";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import type {
  AuthProviderMetadata,
  AvailableSkill,
  ModelInfo,
  Settings,
} from "$lib/api";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  EntityCard,
  EntityRow,
  SettingsInlineMessage,
  SettingsSection,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
} from "$lib/presentation/utils/model";
import {
  readAgentProfiles,
  resetAgentProfile,
  trustAgentProfile,
  updateAgentProfile,
} from "../../../api/agent-profiles.api";
import {
  agentProfilesState,
  refreshAgentProfiles,
} from "../../../state/agent-profiles.svelte";
import { leadProfileOptions } from "../../shared/profile-options.svelte";
import {
  accountKind,
  toolRow,
  toolSummary,
  userToolPayload,
  type AccountOption,
  type ToolId,
  type ToolPayload,
} from "../tools/tool-settings";
import AddProfileChange from "./AddProfileChange.svelte";
import NewProfileDialog from "./NewProfileDialog.svelte";
import ProfileChangeDialog from "./ProfileChangeDialog.svelte";
import ProfileDiagnosticMessage from "./ProfileDiagnosticMessage.svelte";
import ProfileTrustReviewDialog from "./ProfileTrustReviewDialog.svelte";
import {
  type ModelChangeValue,
  changeRows,
  nameFromLabel,
  removeChangePatch,
  setChangePatch,
  skillsSummary,
  type ChangeKey,
} from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

type Props = {
  scope: "user" | "project";
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  skills?: AvailableSkill[];
  projectId?: string;
  /** Opens a profile file in the workbench file viewer. */
  onOpenFile?: (path: string) => void;
};
let {
  scope,
  settingsDraft,
  models = [],
  authProviders = [],
  skills = [],
  projectId,
  onOpenFile,
}: Props = $props();

const project = $derived(scope === "project");
const listProjectId = $derived(project ? projectId : undefined);
const configuration = $derived(agentProfilesState.configuration);
const loadedHere = $derived(
  agentProfilesState.loaded &&
    agentProfilesState.scope === scope &&
    agentProfilesState.projectId === listProjectId,
);
const profiles = $derived(loadedHere ? (configuration?.profiles ?? []) : []);

$effect(() => {
  agentProfilesState.watching = true;
  return () => {
    agentProfilesState.watching = false;
  };
});
$effect(() => {
  void refreshAgentProfiles(listProjectId, scope);
  if (listProjectId) void permissionRuleSetCatalog.ensure(listProjectId);
});

const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const startProfile = $derived(
  scope === "user"
    ? (settingsDraft.defaultAgentProfile ?? DEFAULT_AGENT_PROFILE)
    : undefined,
);

// ---- display ---------------------------------------------------------------

const usableLabels: Record<AgentProfileUsableBy, string> = {
  lead: "main agent",
  subagent: "sub-agent",
  both: "main agent and sub-agent",
};
const usableItems = [
  { value: "lead", label: "Main agent" },
  { value: "subagent", label: "Sub-agent" },
  { value: "both", label: "Main agent and sub-agent" },
];
const groupDefs: { usableBy: AgentProfileUsableBy; title: string }[] = [
  { usableBy: "lead", title: "Main agent" },
  { usableBy: "subagent", title: "Sub-agents" },
  { usableBy: "both", title: "Main agent and sub-agents" },
];

let filter = $state("");
const visible = $derived(
  profiles.filter((profile) => {
    const needle = filter.trim().toLowerCase();
    return (
      !needle ||
      `${profile.name} ${profile.effective?.label ?? ""} ${profile.effective?.description ?? ""}`
        .toLowerCase()
        .includes(needle)
    );
  }),
);
const groups = $derived(
  groupDefs
    .map((group) => ({
      ...group,
      list: visible.filter(
        (profile) =>
          (profile.effective?.usableBy ?? profile.local?.usableBy) ===
          group.usableBy,
      ),
    }))
    .filter((group) => group.list.length > 0),
);
const unreadable = $derived(
  visible.filter((profile) => !profile.effective && !profile.local),
);
const untrusted = $derived(
  profiles.filter((profile) => profile.local && profile.trust === "untrusted"),
);

function modelText(value: unknown): string {
  const setting = (value ?? {}) as ModelChangeValue;
  const found =
    setting.model &&
    models.find((model) => modelKey(model) === modelKey(setting.model!));
  const name = setting.model
    ? found
      ? modelDisplayName(found)
      : setting.model.modelId
    : "";
  const level =
    setting.thinking && setting.thinking !== "off"
      ? setting.thinking.charAt(0).toUpperCase() + setting.thinking.slice(1)
      : "";
  return [name, level].filter(Boolean).join(" · ");
}
const ruleSets = $derived(permissionRuleSetCatalog.summaries(listProjectId));
function accountsFor(tool: ToolId): AccountOption[] {
  const kind = accountKind(tool);
  if (!kind) return [];
  return kind === "tavily"
    ? settingsDraft.providers.tavilyProfiles
    : settingsDraft.providers.atlassianProfiles.map((account) => ({
        id: account.id,
        name: account.name,
        detail: account.siteUrl,
      }));
}
const context = $derived<ProfileEditContext>({
  models: usableModels,
  permissionOptions: ruleSets
    .filter((ruleSet) => ruleSet.enabled)
    .map((ruleSet) => ({ value: ruleSet.id, label: ruleSet.name })),
  skills,
  accountsFor,
  seedTool: (tool) => userToolPayload(settingsDraft, tool),
  leadProfiles: leadProfileOptions(),
});

function valueText(key: ChangeKey, value: unknown): string {
  if (key === "model") return modelText(value);
  if (key === "permission")
    return (
      ruleSets.find((ruleSet) => ruleSet.id === value)?.name ?? String(value)
    );
  if (key === "compaction") {
    const compaction = value as {
      auto: boolean;
      profile: string;
      customTriggerPercent: number;
    };
    return !compaction.auto
      ? "Off"
      : compaction.profile === "custom"
        ? `At ${compaction.customTriggerPercent}%`
        : compaction.profile.charAt(0).toUpperCase() +
          compaction.profile.slice(1);
  }
  if (key === "skills") return skillsSummary(value);
  if (key === "instructions")
    return `+ ${String(value)
      .split("\n")[0]
      .replace(/\{\{skill:([^}]+)\}\}/g, "$1 skill")}`;
  const id = key.slice(5) as ToolId;
  const payload = (value ?? {}) as ToolPayload;
  const label = toolRow(id).label;
  const summary = toolSummary(id, payload, {
    accountName: (_kind, accountId) =>
      accountsFor(id).find((account) => account.id === accountId)?.name,
    profileLabel: (name) =>
      profiles.find((profile) => profile.name === name)?.effective?.label ??
      name,
    modelLabel: (selection) => modelText({ model: selection }),
  });
  return `${label} · ${summary}`;
}

/** The rows of one profile, with whether this layer wrote each setting. */
function rows(profile: AgentProfileConfiguration) {
  const effective = profile.effective;
  if (!effective) return [];
  return changeRows(effective as AgentProfileDraft).map((row) => {
    const origin = row.key.startsWith("tool:")
      ? profile.origins.tools[row.key.slice(5)]
      : profile.origins.fields[row.key];
    return {
      ...row,
      text:
        row.mode === "lead"
          ? "Same as lead agent"
          : valueText(row.key, row.value),
      projectChange:
        project && origin === "project" && Boolean(profile.inherited),
    };
  });
}

// ---- mutations --------------------------------------------------------------

let busy = $state<string>();
let errors = $state<Record<string, string>>({});
let editing = $state<
  Record<
    string,
    { label: string; description: string; usableBy: AgentProfileUsableBy }
  >
>({});

async function mutate(
  name: string,
  action: () => Promise<AgentProfilesConfiguration>,
): Promise<boolean> {
  busy = name;
  delete errors[name];
  try {
    const next = await action();
    agentProfilesState.configuration = next;
    agentProfilesState.loaded = true;
    return true;
  } catch (error) {
    errors[name] = error instanceof Error ? error.message : String(error);
    return false;
  } finally {
    busy = undefined;
  }
}
const target = $derived({ scope, projectId: listProjectId });

function patch(profile: AgentProfileConfiguration, next: AgentProfilePatch) {
  return mutate(profile.name, () =>
    updateAgentProfile({
      ...target,
      name: profile.name,
      expectedDigest: profile.digest,
      patch: next,
    }),
  );
}
function reload(profile: AgentProfileConfiguration) {
  delete errors[profile.name];
  void refreshAgentProfiles(listProjectId, scope);
}

function startEdit(profile: AgentProfileConfiguration): void {
  const effective = profile.effective;
  if (!effective) return;
  editing[profile.name] = {
    label: effective.label,
    description: effective.description,
    usableBy: effective.usableBy,
  };
}
async function finishEdit(profile: AgentProfileConfiguration): Promise<void> {
  const draft = editing[profile.name];
  const effective = profile.effective;
  if (!draft || !effective) return;
  const changed =
    draft.label !== effective.label ||
    draft.description !== effective.description ||
    draft.usableBy !== effective.usableBy;
  if (
    !changed ||
    (await patch(profile, {
      label: draft.label,
      description: draft.description,
      usableBy: draft.usableBy,
    }))
  )
    delete editing[profile.name];
}

// Change editor.
let changeOpen = $state(false);
let changeProfile = $state<AgentProfileConfiguration>();
let changeDraft = $state<ChangeDraft>({
  key: "model",
  mode: "set",
  value: undefined,
});
let changeEditing = $state(false);

function defaultValue(kind: string): unknown {
  if (kind === "compaction") return { ...settingsDraft.compaction };
  if (kind === "skills") return { file: {}, nerve: {}, agentBrowser: {} };
  if (kind === "instructions") return "";
  return undefined;
}
function addChange(profile: AgentProfileConfiguration, kind: string): void {
  changeProfile = profile;
  changeEditing = false;
  changeDraft = {
    key: kind === "tool" ? "tool:" : (kind as ChangeKey),
    mode: "set",
    value: defaultValue(kind),
  };
  changeOpen = true;
}
function editChange(
  profile: AgentProfileConfiguration,
  row: ReturnType<typeof rows>[number],
): void {
  changeProfile = profile;
  changeEditing = true;
  changeDraft = {
    key: row.key,
    mode: row.mode ?? "set",
    value: structuredClone($state.snapshot(row.value)),
  };
  changeOpen = true;
}
function saveChange(next: ChangeDraft): void {
  if (!changeProfile || next.key === "tool:") return;
  void patch(changeProfile, setChangePatch(next.key, next.mode, next.value));
}
const takenKeys = $derived(
  (changeProfile
    ? changeRows(changeProfile.effective as AgentProfileDraft)
    : []
  ).map((row) => row.key),
);

// Create, copy, export, delete.
let newOpen = $state(false);
let newError = $state<string>();
async function createProfile(input: {
  label: string;
  name: string;
  usableBy: AgentProfileUsableBy;
  copyOf?: string;
}): Promise<void> {
  const source = profiles.find(
    (profile) => profile.name === input.copyOf,
  )?.effective;
  const base: AgentProfilePatch = source
    ? profilePatchFrom(source as AgentProfileDraft)
    : {
        description: "Describe when this profile should be used.",
        instructions: "",
      };
  const ok = await mutate(input.name, () =>
    updateAgentProfile({
      ...target,
      name: input.name,
      expectedDigest: null,
      patch: { ...base, label: input.label, usableBy: input.usableBy },
    }),
  );
  if (ok) newOpen = false;
  else newError = errors[input.name];
}

function profilePatchFrom(draft: AgentProfileDraft): AgentProfilePatch {
  return {
    ...(draft.label ? { label: draft.label } : {}),
    description: draft.description,
    usableBy: draft.usableBy,
    instructions: draft.instructions,
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.permission ? { permission: draft.permission } : {}),
    ...(draft.compaction ? { compaction: draft.compaction } : {}),
    ...(draft.tools && Object.keys(draft.tools).length
      ? { tools: draft.tools }
      : {}),
    ...(draft.skills ? { skills: draft.skills } : {}),
  } as AgentProfilePatch;
}
function duplicate(profile: AgentProfileConfiguration): void {
  const effective = profile.effective;
  if (!effective) return;
  const label = `${effective.label} copy`;
  const name = nameFromLabel(label);
  void mutate(name, () =>
    updateAgentProfile({
      ...target,
      name,
      expectedDigest: null,
      patch: { ...profilePatchFrom(effective as AgentProfileDraft), label },
    }),
  );
}
async function copyTo(
  profile: AgentProfileConfiguration,
  to: "user" | "project",
): Promise<void> {
  const effective = profile.effective;
  if (!effective || (to === "project" && !projectId)) return;
  const destination = {
    scope: to,
    projectId: to === "project" ? projectId : undefined,
  };
  await mutate(profile.name, async () => {
    const existing = (await readAgentProfiles(destination)).profiles.find(
      (candidate) => candidate.name === profile.name,
    );
    await updateAgentProfile({
      ...destination,
      name: profile.name,
      expectedDigest: existing?.digest ?? null,
      patch: profilePatchFrom(effective as AgentProfileDraft),
    });
    return readAgentProfiles(target);
  });
}
function exportJson(profile: AgentProfileConfiguration): void {
  const effective = profile.effective;
  if (!effective) return;
  const file = agentProfileDraftSchema.strip().parse(effective);
  void navigator.clipboard?.writeText(
    JSON.stringify({ schemaVersion: 2, ...file }, null, 2),
  );
}

let confirmOpen = $state(false);
let confirmation = $state<{
  kind: "delete" | "reset";
  profile: AgentProfileConfiguration;
}>();
function ask(
  kind: "delete" | "reset",
  profile: AgentProfileConfiguration,
): void {
  confirmation = { kind, profile };
  confirmOpen = true;
}
function confirmAction(): void {
  const current = confirmation;
  if (!current) return;
  void mutate(current.profile.name, () =>
    resetAgentProfile({
      ...target,
      name: current.profile.name,
      expectedDigest: current.profile.digest,
    }),
  );
}

// Trust review.
let reviewOpen = $state(false);
let reviewProfile = $state<AgentProfileConfiguration>();
function review(profile: AgentProfileConfiguration): void {
  reviewProfile = profile;
  reviewOpen = true;
}
const reviewLines = $derived(
  reviewProfile
    ? [
        ...rows(reviewProfile).map((row) => ({
          label: row.label,
          value: row.text,
        })),
      ]
    : [],
);
async function trust(): Promise<void> {
  const current = reviewProfile;
  if (!current?.digest || !projectId) return;
  if (
    await mutate(current.name, () =>
      trustAgentProfile({
        projectId,
        name: current.name,
        digest: current.digest!,
      }),
    )
  )
    reviewOpen = false;
}

function filePath(profile: AgentProfileConfiguration): string {
  return (
    profile.path ??
    (project
      ? `.nerve/agent-profiles/${profile.name}.json`
      : `~/.nerve/data/agent-profiles/${profile.name}.json`)
  );
}
function isBuiltin(profile: AgentProfileConfiguration): boolean {
  return (
    profile.effective?.source === "builtin" ||
    (profile.inherited !== null && !profile.local)
  );
}
</script>

<SettingsInlineMessage
  tone="neutral"
  text="Profiles are templates. Changes apply the next time a profile is applied, not to running conversations."
/>

{#if agentProfilesState.error && !loadedHere}
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

{#each configuration?.diagnostics ?? [] as diagnostic, index (index)}
  <SettingsInlineMessage
    tone={diagnostic.severity === "blocking" ? "destructive" : "warning"}
    text={diagnostic.message}
  />
{/each}

{#if project && untrusted.length > 0}
  <SettingsInlineMessage
    tone="warning"
    text={`${untrusted.length} project profile ${untrusted.length === 1 ? "file needs" : "files need"} review before ${untrusted.length === 1 ? "it applies" : "they apply"}. Each file is trusted on its own.`}
  >
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={() => review(untrusted[0])}
        >Review</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#if !loadedHere}
  <Skeleton class="h-24 w-full" />
  <Skeleton class="h-24 w-full" />
{:else}
  <div class="flex items-center justify-between gap-2">
    <div class="w-64 max-w-full">
      <SearchInput
        bind:value={filter}
        placeholder="Filter profiles"
        ariaLabel="Filter profiles"
      />
    </div>
    <Button
      size="sm"
      variant="outline"
      disabled={project && !projectId}
      onclick={() => {
        newError = undefined;
        newOpen = true;
      }}
    >
      <Plus class="size-3" aria-hidden="true" />New profile
    </Button>
  </div>

  {#each groups as group (group.usableBy)}
    <SettingsSection
      id={`profiles-${group.usableBy}`}
      title={group.title}
      surface={false}
    >
      {#each group.list as profile (profile.name)}
        {@const effective = profile.effective}
        {@const edit = editing[profile.name]}
        {@const own = Boolean(profile.local)}
        {@const profileRows = rows(profile)}
        {#if effective}
          <EntityCard>
            {#snippet head()}
              {#if edit}
                <div class="grid gap-1.5">
                  {#if errors[profile.name]}
                    <SettingsInlineMessage
                      tone="warning"
                      text={errors[profile.name]}
                    >
                      {#snippet actions()}
                        <Button
                          size="sm"
                          variant="outline"
                          onclick={() => reload(profile)}>Reload</Button
                        >
                      {/snippet}
                    </SettingsInlineMessage>
                  {/if}
                  <Input
                    bind:value={edit.label}
                    aria-label="Label"
                    maxlength={80}
                  />
                  <Input
                    bind:value={edit.description}
                    aria-label="When to use"
                    maxlength={200}
                  />
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-muted-foreground">Usable by</span>
                    <div class="w-56">
                      <SelectField
                        items={usableItems}
                        value={edit.usableBy}
                        ariaLabel="Usable by"
                        onValueChange={(next) =>
                          (edit.usableBy = next as AgentProfileUsableBy)}
                      />
                    </div>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Name <span class="font-mono">{profile.name}</span> is the file
                    name and can't change.
                  </p>
                </div>
              {:else}
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <h4 class="text-sm font-medium text-foreground">
                    {effective.label}
                  </h4>
                  {#if !project && profile.name === startProfile && effective.usableBy !== "subagent"}<Badge
                      variant="accent">Starts new conversations</Badge
                    >{/if}
                  {#if effective.source === "builtin" || isBuiltin(profile)}<Badge
                      variant="neutral">Built-in</Badge
                    >{/if}
                  {#if own && profile.inherited}<Badge variant="neutral"
                      >Customized</Badge
                    >{/if}
                  {#if project && effective.source === "project" && !profile.inherited}<Badge
                      variant="info">Project only</Badge
                    >{/if}
                  {#if profile.trust === "untrusted" && own}<Badge
                      variant="warning">Needs review</Badge
                    >{/if}
                  {#if profile.diagnostics.some((item) => item.severity === "blocking")}<Badge
                      variant="destructive">Can't be used</Badge
                    >
                  {:else if profile.diagnostics.length}<Badge variant="warning"
                      >Reduced capabilities</Badge
                    >{/if}
                  {#if !effective.enabled}<Badge variant="neutral"
                      >Disabled</Badge
                    >{/if}
                </div>
                <p class="text-xs text-muted-foreground">
                  {effective.description} Usable by {usableLabels[
                    effective.usableBy
                  ]}.
                </p>
                {#each profile.diagnostics as diagnostic, index (index)}
                  <ProfileDiagnosticMessage {diagnostic} />
                {/each}
                {#if errors[profile.name]}
                  <p class="text-xs text-destructive" role="alert">
                    {errors[profile.name]}
                  </p>
                {/if}
              {/if}
            {/snippet}
            {#snippet actions()}
              <Switch
                checked={effective.enabled}
                disabled={busy === profile.name}
                aria-label={`${effective.label} available in ${project ? "this project" : "your settings"}`}
                onCheckedChange={(enabled) => void patch(profile, { enabled })}
              />
              <IconAction
                icon={edit ? Check : Pencil}
                label={edit ? "Done" : "Edit label, description and usable by"}
                onclick={() =>
                  edit ? void finishEdit(profile) : startEdit(profile)}
              />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                  aria-label={`${effective.label} actions`}
                >
                  <Ellipsis class="size-3.5" aria-hidden="true" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-56">
                  <DropdownMenu.Item onSelect={() => duplicate(profile)}
                    >Duplicate as new profile</DropdownMenu.Item
                  >
                  {#if !project}
                    {#if projectId}<DropdownMenu.Item
                        onSelect={() => void copyTo(profile, "project")}
                        >Copy to project</DropdownMenu.Item
                      >{/if}
                  {:else}
                    <DropdownMenu.Item
                      onSelect={() => void copyTo(profile, "user")}
                      >Copy to user</DropdownMenu.Item
                    >
                  {/if}
                  <DropdownMenu.Item onSelect={() => exportJson(profile)}
                    >Export as JSON</DropdownMenu.Item
                  >
                  {#if onOpenFile && own}<DropdownMenu.Item
                      onSelect={() => onOpenFile?.(filePath(profile))}
                      >Open file</DropdownMenu.Item
                    >{/if}
                  {#if own}
                    <DropdownMenu.Separator />
                    {#if profile.inherited}
                      <DropdownMenu.Item onSelect={() => ask("reset", profile)}
                        >Reset customizations</DropdownMenu.Item
                      >
                    {:else}
                      <DropdownMenu.Item
                        variant="destructive"
                        onSelect={() => ask("delete", profile)}
                        >Delete profile</DropdownMenu.Item
                      >
                    {/if}
                  {/if}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/snippet}

            {#each profileRows as row (row.key)}
              <EntityRow
                label={row.label}
                value={row.text}
                editLabel={`Edit ${row.label.toLowerCase()}`}
                removeLabel={`Remove. ${row.label} uses the agent settings`}
                onEdit={() => editChange(profile, row)}
                onRemove={() => void patch(profile, removeChangePatch(row.key))}
              >
                {#snippet trailing()}
                  {#if row.mode === "lock"}<Badge variant="outline"
                      ><Lock aria-hidden="true" />Locked</Badge
                    >
                  {:else if row.mode === "set"}<Badge variant="outline"
                      >Set</Badge
                    >{/if}
                  {#if row.projectChange}<Badge variant="info">Project</Badge
                    >{/if}
                {/snippet}
              </EntityRow>
            {:else}
              <p class="px-3 py-2 text-xs text-muted-foreground">
                No changes. Uses the agent settings.
              </p>
            {/each}

            {#snippet footer()}
              <div class="flex items-center justify-between gap-3">
                <AddProfileChange
                  profileLabel={effective.label}
                  taken={profileRows.map((row) => row.key)}
                  onPick={(kind) => addChange(profile, kind)}
                />
                <span
                  class={own
                    ? "truncate pr-2 font-mono text-xs text-muted-foreground"
                    : "truncate pr-2 text-xs text-muted-foreground"}
                  title={own ? filePath(profile) : undefined}
                >
                  {own
                    ? filePath(profile)
                    : "Built-in · edits are saved as your own file"}
                </span>
              </div>
            {/snippet}
          </EntityCard>
        {/if}
      {/each}
    </SettingsSection>
  {:else}
    <p class="text-sm text-muted-foreground">
      {filter ? "No profiles match." : "No profiles yet."}
    </p>
  {/each}

  {#each unreadable as profile (profile.name)}
    <EntityCard title={profile.name}>
      {#snippet badges()}<Badge variant="destructive">Can't be used</Badge
        >{/snippet}
      {#snippet footer()}
        <div class="grid gap-1 px-1.5 py-1">
          {#each profile.diagnostics as diagnostic, index (index)}
            <ProfileDiagnosticMessage {diagnostic} />
          {/each}
          {#if onOpenFile && profile.path}
            <Button
              size="sm"
              variant="ghost"
              class="w-fit"
              onclick={() => onOpenFile?.(profile.path!)}>Open file</Button
            >
          {/if}
        </div>
      {/snippet}
    </EntityCard>
  {/each}
{/if}

{#if changeProfile?.effective}
  <ProfileChangeDialog
    bind:open={changeOpen}
    profileLabel={changeProfile.effective.label}
    usableBy={changeProfile.effective.usableBy}
    change={changeDraft}
    editing={changeEditing}
    takenTools={takenKeys}
    {context}
    onSave={saveChange}
  />
{/if}

<NewProfileDialog
  bind:open={newOpen}
  {scope}
  {profiles}
  error={newError}
  onCreate={createProfile}
/>
<ProfileTrustReviewDialog
  bind:open={reviewOpen}
  profile={reviewProfile}
  lines={reviewLines}
  busy={busy === reviewProfile?.name}
  error={reviewProfile ? errors[reviewProfile.name] : undefined}
  onTrust={() => void trust()}
/>
<ConfirmDialog
  bind:open={confirmOpen}
  destructive
  title={confirmation?.kind === "reset"
    ? `Reset ${confirmation.profile.effective?.label}?`
    : `Delete ${confirmation?.profile.effective?.label ?? confirmation?.profile.name}?`}
  description={confirmation?.kind === "reset"
    ? `Removes ${confirmation ? filePath(confirmation.profile) : ""} and returns to the inherited definition. Conversations that already applied it keep their settings.`
    : `Deletes ${confirmation ? filePath(confirmation.profile) : ""}. Conversations that already applied it keep their settings.`}
  confirmLabel={confirmation?.kind === "reset" ? "Reset" : "Delete"}
  onConfirm={confirmAction}
/>
