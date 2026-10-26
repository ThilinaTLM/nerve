<script lang="ts">
import { untrack } from "svelte";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import {
  profileDefinitionSchema,
  type ProfileCatalogEntry,
  type ProfileDefinition,
  type PreferenceScope,
} from "@nervekit/contracts/agent-configuration";
import type {
  AuthProviderMetadata,
  AvailableSkill,
  ModelInfo,
  Settings,
} from "$lib/api";
import {
  EntityCard,
  EntityRow,
  SettingsInlineMessage,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelKey,
  modelDisplayName,
} from "$lib/presentation/utils/model";
import type { ModelSelection } from "@nervekit/contracts/models";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import {
  agentProfilesState,
  refreshAgentProfiles,
} from "../../../state/agent-profiles.svelte";
import {
  readAgentProfiles,
  readScopedProfile,
  saveScopedProfile,
  resetAgentProfile,
  trustAgentProfile,
} from "../../../api/agent-profiles.api";
import {
  accountKind,
  toolRow,
  toolSummary,
  type ToolPayload,
  type ToolId,
} from "../tools/tool-settings";
import ConfigurationRepairDialog from "../capabilities/ConfigurationRepairDialog.svelte";
import AddProfileChange from "./AddProfileChange.svelte";
import NewProfileDialog from "./NewProfileDialog.svelte";
import ProfileChangeDialog from "./ProfileChangeDialog.svelte";
import ProfileTrustReviewDialog from "./ProfileTrustReviewDialog.svelte";
import {
  applyProfileChange,
  changeRows,
  modeLabels,
  skillsSummary,
  type ChangeKey,
  type ChangeRow,
  type ModelChangeValue,
} from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";
import type { ProfileKind } from "./profile-kind";
let {
  kind,
  scope,
  projectId,
  settingsDraft,
  models = [],
  authProviders = [],
  skills = [],
  onOpenFile,
}: {
  kind: ProfileKind;
  scope: "user" | "project";
  projectId?: string;
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  skills?: AvailableSkill[];
  onOpenFile?: (path: string) => void;
} = $props();
const uid = $props.id();
const target = $derived<PreferenceScope | undefined>(
  scope === "project"
    ? projectId
      ? { scope, projectId }
      : undefined
    : { scope },
);
const launchPreferences = new ScopedAgentState();
$effect(() => {
  const currentTarget = target;
  void all;
  if (currentTarget) untrack(() => void launchPreferences.load(currentTarget));
});
$effect(() => launchPreferences.observe());
function launchEnabled(profile: ProfileCatalogEntry): boolean {
  return (
    launchPreferences.resolution?.settings.subagents?.[profile.name]?.enabled ??
    profile.definition?.enabled ??
    true
  );
}
let filter = $state("");
let busy = $state<string>();
let errors = $state<Record<string, string>>({});
const loaded = $derived(
  agentProfilesState.loaded &&
    agentProfilesState.scope === scope &&
    agentProfilesState.projectId ===
      (scope === "project" ? projectId : undefined),
);
const all = $derived(
  loaded ? (agentProfilesState.configuration?.profiles ?? []) : [],
);
const profiles = $derived(
  all.filter(
    (p) =>
      (!p.definition ||
        (kind === "lead"
          ? p.definition.usableBy !== "subagent"
          : p.definition.usableBy !== "lead")) &&
      `${p.name} ${p.definition?.label ?? ""} ${p.definition?.description ?? ""}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  ),
);
$effect(() => {
  agentProfilesState.watching = true;
  return () => {
    agentProfilesState.watching = false;
  };
});
$effect(() => {
  if (target)
    void refreshAgentProfiles(
      target.scope === "project" ? target.projectId : undefined,
      target.scope,
    );
  if (projectId) void permissionRuleSetCatalog.ensure(projectId);
});
const rules = $derived(
  permissionRuleSetCatalog.summaries(
    scope === "project" ? projectId : undefined,
  ),
);
function accountsFor(tool: ToolId) {
  const account = accountKind(tool);
  return account === "tavily"
    ? settingsDraft.providers.tavilyProfiles
    : account === "atlassian"
      ? settingsDraft.providers.atlassianProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          detail: p.siteUrl,
        }))
      : [];
}
const context = $derived<ProfileEditContext>({
  models: authenticatedRealModelOptions(models, authProviders),
  permissionOptions: rules
    .filter((r) => r.enabled)
    .map((r) => ({ value: r.id, label: r.name })),
  skills,
  accountsFor,
  seedTool: (tool) =>
    resolveAgentConfiguration({ role: "lead" }).settings.tools?.[tool] ?? {},
  leadProfiles: all
    .filter((p) => p.definition && p.definition.usableBy !== "subagent")
    .map((p) => ({ name: p.name, label: p.definition?.label ?? p.name })),
});
async function reload() {
  if (!target) return;
  await refreshAgentProfiles(
    target.scope === "project" ? target.projectId : undefined,
    target.scope,
  );
  await agentProfileCatalog.refresh(
    target.scope === "project" ? target.projectId : undefined,
  );
}
async function reloadProfiles(name?: string) {
  const scope = target;
  if (!scope) return;
  try {
    const names = name
      ? [name]
      : [
          ...new Set([
            ...all.map((p) => p.name),
            ...(await readAgentProfiles(scope)).profiles.map((p) => p.name),
          ]),
        ];
    for (const name of names)
      await requestWorkbench("agentConfiguration.reload", {
        target: { document: "profile", scope, name },
      });
    if (scope !== target) return;
    if (name) delete errors[name];
    await reload();
  } catch (error) {
    if (scope !== target) return;
    const message = error instanceof Error ? error.message : String(error);
    if (name) errors[name] = message;
    else agentProfilesState.error = message;
  }
}
async function mutate(name: string, action: () => Promise<{ status: string }>) {
  if (busy) return false;
  busy = name;
  delete errors[name];
  try {
    const result = await action();
    if (result.status !== "saved")
      throw new Error(
        `${result.status}: reload and review before saving again.`,
      );
    await reload();
    return true;
  } catch (error) {
    errors[name] = error instanceof Error ? error.message : String(error);
    return false;
  } finally {
    busy = undefined;
  }
}
async function snapshot(profile: ProfileCatalogEntry) {
  if (!target) throw new Error("Choose a project first.");
  const capturedScope = target;
  const read = await readScopedProfile(capturedScope, profile.name);
  if (capturedScope !== target)
    throw new Error("Settings scope changed; review again.");
  if (read.status !== "available")
    throw new Error(`Profile ${read.status}; reload before editing.`);
  if (read.profile.digest !== profile.digest || !read.profile.definition)
    throw new Error("Profile changed; reload before editing.");
  return {
    scope: capturedScope,
    profile: read.profile,
    definition: structuredClone(read.profile.definition),
    expectedDigest: read.localDigest,
  };
}
function modelText(selection?: ModelSelection) {
  const model = models.find(
    (m) => selection && modelKey(m) === modelKey(selection),
  );
  return model
    ? modelDisplayName(model)
    : (selection?.modelId ?? "Use settings");
}
function text(row: ChangeRow) {
  if (row.key === "model") {
    const value = row.value as ModelChangeValue;
    return `${modelText(value.model)} · ${value.thinking ?? "Use settings"}`;
  }
  if (row.key === "compaction") {
    const value = row.value as {
      auto?: boolean;
      profile?: string;
      customTriggerPercent?: number;
    };
    return value.auto === false
      ? "Off"
      : value.profile === "custom"
        ? `At ${value.customTriggerPercent}%`
        : (value.profile ?? "Use settings");
  }
  if (row.key === "skills") return skillsSummary(row.value);
  if (row.key === "permission")
    return rules.find((r) => r.id === row.value)?.name ?? String(row.value);
  if (row.key === "instructions") return String(row.value);
  const id = row.key.slice(5) as ToolId;
  return toolSummary(id, row.value as ToolPayload, {
    accountName: (_kind, accountId) =>
      accountsFor(id).find((a) => a.id === accountId)?.name,
    profileLabel: (name) =>
      all.find((p) => p.name === name)?.definition?.label ?? name,
    modelLabel: (selection) => modelText(selection as ModelSelection),
  });
}
let metadata = $state<{
  name: string;
  scope: PreferenceScope;
  expectedDigest: string;
  definition: ProfileDefinition;
}>();
async function editMetadata(profile: ProfileCatalogEntry) {
  try {
    const base = await snapshot(profile);
    metadata = {
      name: profile.name,
      scope: base.scope,
      expectedDigest: base.expectedDigest,
      definition: base.definition,
    };
  } catch (error) {
    errors[profile.name] = String(error);
  }
}
async function saveMetadata() {
  const draft = metadata;
  if (!draft || !target) return;
  if (
    await mutate(draft.name, () =>
      saveScopedProfile({
        scope: draft.scope,
        name: draft.name,
        expectedDigest: draft.expectedDigest,
        definition: profileDefinitionSchema.parse(
          $state.snapshot(draft.definition),
        ),
      }),
    )
  )
    metadata = undefined;
}
let changeOpen = $state(false);
let changeBase = $state<Awaited<ReturnType<typeof snapshot>>>();
let changeDraft = $state<ChangeDraft>({
  key: "model",
  mode: "recommend",
  value: undefined,
});
let changeEditing = $state(false);
let changeMixed = $state(false);
async function change(
  profile: ProfileCatalogEntry,
  key: string,
  row?: ChangeRow,
) {
  try {
    changeBase = await snapshot(profile);
    changeEditing = !!row;
    changeMixed = row?.key !== "model" && (row?.mixed ?? false);
    changeDraft = {
      key: key === "tool" ? "tool:" : (key as ChangeKey),
      mode: row?.mode ?? "recommend",
      value: row
        ? structuredClone($state.snapshot(row.value))
        : key === "compaction"
          ? { auto: true, profile: "balanced", customTriggerPercent: 80 }
          : key === "skills"
            ? { file: {}, nerve: {}, agentBrowser: {} }
            : key === "instructions"
              ? ""
              : undefined,
    };
    changeOpen = true;
  } catch (error) {
    errors[profile.name] = String(error);
  }
}
async function saveChange(next: ChangeDraft) {
  const base = changeBase;
  if (!base || !target) return;
  const ok = await mutate(base.profile.name, () =>
    saveScopedProfile({
      scope: base.scope,
      name: base.profile.name,
      expectedDigest: base.expectedDigest,
      definition: applyProfileChange($state.snapshot(base.definition), next),
    }),
  );
  if (!ok)
    throw new Error(errors[base.profile.name] ?? "Could not save profile.");
}
let newOpen = $state(false);
let newError = $state<string>();
async function create(input: {
  label: string;
  name: string;
  description: string;
  copyOf?: string;
}) {
  if (!target) return;
  const source = all.find((p) => p.name === input.copyOf)?.definition;
  const definition = profileDefinitionSchema.parse({
    ...(source
      ? structuredClone($state.snapshot(source))
      : { schemaVersion: 1, instructions: "", usableBy: kind }),
    name: input.name,
    label: input.label,
    description: input.description || source?.description,
  });
  if (
    await mutate(input.name, () =>
      saveScopedProfile({
        scope: target,
        name: input.name,
        expectedDigest: "missing",
        definition,
      }),
    )
  )
    newOpen = false;
  else newError = errors[input.name];
}
let deleteOpen = $state(false);
let deleting = $state<Awaited<ReturnType<typeof snapshot>>>();
async function askDelete(profile: ProfileCatalogEntry) {
  try {
    deleting = await snapshot(profile);
    deleteOpen = true;
  } catch (error) {
    errors[profile.name] = String(error);
  }
}
async function remove() {
  const current = deleting;
  if (!current || !target) return;
  await mutate(current.profile.name, () =>
    resetAgentProfile({
      scope: current.scope,
      name: current.profile.name,
      expectedDigest: current.expectedDigest,
    }),
  );
}
let reviewOpen = $state(false);
let reviewProfile = $state<ProfileCatalogEntry>();
async function trust() {
  const profile = reviewProfile;
  if (!profile || target?.scope !== "project") return;
  if (
    await mutate(profile.name, () =>
      trustAgentProfile({
        target: { document: "profile", scope: target, name: profile.name },
        expectedDigest: profile.digest,
        trusted: !profile.trusted,
      }),
    )
  )
    reviewOpen = false;
}
let repairOpen = $state(false);
let repairProfile = $state<ProfileCatalogEntry>();
const editingScopeKey = $derived(`${scope}:${projectId ?? ""}:${kind}`);
$effect(() => {
  void editingScopeKey;
  metadata = undefined;
  changeOpen = false;
  newOpen = false;
  reviewOpen = false;
  repairOpen = false;
  deleteOpen = false;
});
const repairReplacement = $derived(
  repairProfile?.definition ?? {
    schemaVersion: 1,
    name: repairProfile?.name ?? "recovered",
    description: "Recovered profile",
    usableBy: kind,
    instructions: "",
  },
);
</script>
{#if launchPreferences.error}<SettingsInlineMessage
    tone="destructive"
    text={launchPreferences.error}
    >{#snippet actions()}<Button
        size="sm"
        variant="outline"
        onclick={() => launchPreferences.reload()}>Reload</Button
      >{/snippet}</SettingsInlineMessage
  >{/if}
{#if agentProfilesState.error}<SettingsInlineMessage
    tone="destructive"
    text={agentProfilesState.error}
    >{#snippet actions()}<Button
        size="sm"
        variant="outline"
        onclick={() => reloadProfiles()}>Reload</Button
      >{/snippet}</SettingsInlineMessage
  >{/if}
{#each agentProfilesState.configuration?.diagnostics ?? [] as diagnostic, index (index)}<SettingsInlineMessage
    tone="warning"
    text={`${diagnostic.code}: ${diagnostic.path}${diagnostic.pointer}`}
  />{/each}
<div class="flex items-center justify-between gap-2">
  <SearchInput
    bind:value={filter}
    placeholder="Search profiles"
    ariaLabel="Search profiles"
    class="max-w-xs"
  /><Button
    size="sm"
    variant="outline"
    disabled={!target || !!busy}
    onclick={() => {
      newError = undefined;
      newOpen = true;
    }}><Plus class="size-3.5" />New profile</Button
  >
</div>
{#each profiles as profile (profile.name)}
  <EntityCard
    title={profile.definition?.label ?? profile.name}
    description={profile.definition?.description}
  >
    {#snippet badges()}<Badge variant="outline"
        >{profile.source === "builtin"
          ? "Built-in"
          : profile.source === "user"
            ? "User"
            : "Project"}</Badge
      >{#if !profile.local}<Badge variant="outline">Inherited</Badge
        >{/if}{#if profile.definition?.usableBy !== "lead" && !launchEnabled(profile)}<Badge
          variant="outline">Off</Badge
        >{/if}{#if profile.source === "project" && !profile.trusted}<Badge
          variant="warning">Needs trust</Badge
        >{/if}{/snippet}
    {#snippet actions()}{#if profile.definition}{#if profile.definition.usableBy !== "lead"}<Switch
            checked={launchEnabled(profile)}
            disabled={!!busy ||
              launchPreferences.saving ||
              !launchPreferences.resolution ||
              !profile.trusted}
            aria-label={`Enable ${profile.definition.label ?? profile.name} launches`}
            onCheckedChange={(enabled) =>
              launchPreferences.save({
                subagents: { [profile.name]: { enabled } },
              })}
          />{/if}<IconAction
          icon={Pencil}
          label={`Edit ${profile.definition.label ?? profile.name}`}
          disabled={!!busy}
          onclick={() => editMetadata(profile)}
        />{/if}{#if profile.local && profile.definition}<IconAction
          icon={Trash2}
          label={`Delete local ${profile.name}`}
          disabled={!!busy}
          onclick={() => askDelete(profile)}
        />{/if}{/snippet}
    {#if errors[profile.name]}<SettingsInlineMessage
        tone="destructive"
        text={errors[profile.name]}
        >{#snippet actions()}<Button
            size="sm"
            variant="outline"
            onclick={() => reloadProfiles(profile.name)}>Reload</Button
          >{/snippet}</SettingsInlineMessage
      >{/if}
    {#if metadata?.name === profile.name}
      <div class="grid gap-2">
        <Label for={`${uid}-${profile.name}-label`}>Label</Label><Input
          id={`${uid}-${profile.name}-label`}
          bind:value={metadata.definition.label}
        /><Label for={`${uid}-${profile.name}-description`}>Description</Label
        ><Textarea
          id={`${uid}-${profile.name}-description`}
          bind:value={metadata.definition.description}
        />
        <div class="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onclick={() => (metadata = undefined)}>Cancel</Button
          ><Button
            size="sm"
            disabled={!!busy || !metadata.definition.description.trim()}
            onclick={saveMetadata}>Save</Button
          >
        </div>
      </div>
    {/if}
    {#if !profile.local}<p class="text-xs text-muted-foreground">
        Editing creates a complete {scope} copy that shadows this definition. It does
        not change existing conversation snapshots.
      </p>{/if}
    {#if profile.definition}
      {#each changeRows(profile.definition) as row (row.key)}<EntityRow
          label={row.key.startsWith("tool:")
            ? toolRow(row.key.slice(5) as ToolId).label
            : row.label}
          value={text(row)}
          >{#snippet trailing()}{#if row.mode}<Badge variant="outline"
                >{row.mixed ? "Mixed policies" : modeLabels[row.mode]}</Badge
              >{/if}<IconAction
              icon={Pencil}
              label={`Change ${row.label} · ${profile.definition?.label ?? profile.name}`}
              disabled={!!busy}
              onclick={() => change(profile, row.key, row)}
            />{/snippet}</EntityRow
        >{/each}
      <AddProfileChange
        profileLabel={profile.definition.label ?? profile.name}
        taken={[
          ...changeRows(profile.definition).map((r) => r.key),
          ...(profile.definition.usableBy !== "lead"
            ? (["permission", "compaction"] as ChangeKey[])
            : []),
        ]}
        onPick={(key) => change(profile, key)}
      />
    {/if}
    {#each profile.diagnostics as diagnostic, index (index)}<SettingsInlineMessage
        tone="warning"
        text={`${diagnostic.code}: ${diagnostic.pointer}`}
        >{#snippet actions()}<Button
            size="sm"
            variant="outline"
            onclick={() => reloadProfiles(profile.name)}>Reload</Button
          >{/snippet}</SettingsInlineMessage
      >{/each}
    <div class="flex flex-wrap items-center gap-2">
      {#if profile.source === "project" && profile.definition}<Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onclick={() => {
            reviewProfile = profile;
            reviewOpen = true;
          }}
          >{profile.trusted
            ? "Review / revoke trust"
            : "Review and trust"}</Button
        >{/if}{#if profile.local}<Button
          size="sm"
          variant="ghost"
          disabled={!!busy}
          onclick={() => {
            repairProfile = profile;
            repairOpen = true;
          }}>Preview repair</Button
        >{/if}{#if onOpenFile && profile.source !== "builtin"}<Button
          size="sm"
          variant="ghost"
          onclick={() => onOpenFile?.(profile.path)}>Open file</Button
        >{/if}
    </div>
    <EntityRow label="Profile" value={profile.name} />
  </EntityCard>
{/each}
<NewProfileDialog
  bind:open={newOpen}
  {kind}
  {scope}
  profiles={all}
  error={newError}
  onCreate={create}
/>
{#if changeBase}<ProfileChangeDialog
    bind:open={changeOpen}
    profileLabel={changeBase.definition.label ?? changeBase.definition.name}
    usableBy={changeBase.definition.usableBy}
    change={changeDraft}
    editing={changeEditing}
    mixed={changeMixed}
    takenTools={changeRows(changeBase.definition)
      .filter((r) => r.key.startsWith("tool:"))
      .map((r) => r.key.slice(5))}
    {context}
    onSave={saveChange}
  />{/if}
<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete local profile copy?"
  description="Only this complete local copy is deleted. Future applications reveal the lower definition, if any. Existing conversation snapshots are unchanged."
  confirmLabel="Delete local copy"
  onConfirm={remove}
/>
<ProfileTrustReviewDialog
  bind:open={reviewOpen}
  profile={reviewProfile}
  lines={reviewProfile?.definition
    ? changeRows(reviewProfile.definition).map((row) => ({
        label: row.label,
        value: text(row),
      }))
    : []}
  busy={!!busy}
  error={reviewProfile ? errors[reviewProfile.name] : undefined}
  onTrust={trust}
/>
{#if target && repairProfile}{#key `${JSON.stringify(target)}:${repairProfile.name}`}<ConfigurationRepairDialog
      bind:open={repairOpen}
      target={{ document: "profile", scope: target, name: repairProfile.name }}
      replacement={repairReplacement}
      onRepaired={reload}
    />{/key}{/if}
