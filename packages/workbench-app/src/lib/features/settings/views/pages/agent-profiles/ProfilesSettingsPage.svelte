<script lang="ts">
import { untrack } from "svelte";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import FileText from "@lucide/svelte/icons/file-text";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
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
import { EntityCard, SettingsInlineMessage } from "$lib/presentation/settings";
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
import ProfileEditorDialog from "./ProfileEditorDialog.svelte";
import ProfileChangeChip from "./ProfileChangeChip.svelte";
import Copy from "@lucide/svelte/icons/copy";
import ProfileTrustReviewDialog from "./ProfileTrustReviewDialog.svelte";
import {
  applyProfileChange,
  changeRows,
  duplicateProfileName,
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
/** A model chosen for launches in an earlier version of this page (the
 * "Sub-agent launches" section). It outranks the profile's recommended
 * model, so it is surfaced on the card until cleared. */
function launchModelOverride(profile: ProfileCatalogEntry) {
  const own = launchPreferences.overrides.subagents?.[profile.name];
  if (!own?.model && !own?.reasoningLevel) return undefined;
  const definition = profile.definition;
  const model =
    definition?.requirements?.model ?? definition?.recommendations?.model;
  const level =
    definition?.requirements?.reasoningLevel ??
    definition?.recommendations?.reasoningLevel;
  const sameModel =
    !own.model ||
    (own.model.provider === model?.provider &&
      own.model.modelId === model?.modelId);
  const sameLevel = !own.reasoningLevel || own.reasoningLevel === level;
  // Matching values change nothing; only a differing launch choice matters.
  return sameModel && sameLevel ? undefined : own;
}
function clearLaunchModel(profile: ProfileCatalogEntry) {
  const pointer = `/overrides/subagents/${profile.name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  void launchPreferences.save({}, [
    `${pointer}/model`,
    `${pointer}/reasoningLevel`,
  ]);
}
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
      `${p.name} ${p.definition?.label ?? ""} ${p.definition?.whenToUse ?? ""}`
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
    .toSorted((a, b) => {
      const order = [
        "read_only",
        "planning",
        "baseline",
        "supervised",
        "autonomous",
      ];
      return (
        (a.source === "builtin" ? order.indexOf(a.id) : order.length) -
        (b.source === "builtin" ? order.indexOf(b.id) : order.length)
      );
    })
    .map((r) => ({ value: r.id, label: r.name, detail: r.description })),
  skills,
  defaultPermission: launchPreferences.resolution?.settings.permissionRuleSetId,
  skillEnabled: (source, name) => {
    const skills = launchPreferences.resolution?.settings.skills;
    return skills?.[source]?.[name] ?? skills?.defaults?.[source] ?? true;
  },
  accountsFor,
  seedTool: (tool) =>
    launchPreferences.resolution?.settings.tools?.[tool] ??
    resolveAgentConfiguration({ role: "lead" }).settings.tools?.[tool] ??
    {},
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
  if (row.key.startsWith("skill:")) return row.value ? "On" : "Off";
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
let newOpen = $state(false);
let newDefinition = $state<ProfileDefinition>();
function openNew(profile?: ProfileCatalogEntry) {
  newDefinition = profile?.definition
    ? {
        ...structuredClone($state.snapshot(profile.definition)),
        name: duplicateProfileName(profile.name),
        label: `${profile.definition.label ?? profile.name} copy`,
      }
    : {
        schemaVersion: 1,
        name: "",
        label: "",
        whenToUse: "",
        instructions: "",
        usableBy: kind,
      };
  newOpen = true;
}
async function saveDefinition(definition: ProfileDefinition) {
  const edit = metadata;
  const name = edit?.name ?? definition.name;
  if (!target) throw new Error("Choose a project first.");
  const ok = await mutate(name, () =>
    saveScopedProfile({
      scope: edit?.scope ?? target!,
      name,
      expectedDigest: edit?.expectedDigest ?? "missing",
      definition: profileDefinitionSchema.parse(definition),
    }),
  );
  if (!ok) throw new Error(errors[name] ?? "Could not save profile.");
  metadata = undefined;
}
async function persistChange(
  profile: ProfileCatalogEntry,
  change: ChangeDraft,
) {
  const current = all.find((p) => p.name === profile.name);
  if (!current) throw new Error("Profile no longer exists.");
  const base = await snapshot(current);
  const ok = await mutate(profile.name, () =>
    saveScopedProfile({
      scope: base.scope,
      name: profile.name,
      expectedDigest: base.expectedDigest,
      definition: applyProfileChange(base.definition, change),
    }),
  );
  if (!ok) throw new Error(errors[profile.name] ?? "Could not save profile.");
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
  newOpen = false;
  reviewOpen = false;
  repairOpen = false;
  deleteOpen = false;
});
const repairReplacement = $derived(
  repairProfile?.definition ?? {
    schemaVersion: 1,
    name: repairProfile?.name ?? "recovered",
    whenToUse: "Use when recovering this profile.",
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
      metadata = undefined;
      openNew();
    }}><Plus class="size-3.5" />New profile</Button
  >
</div>
{#each profiles as profile (profile.name)}
  <EntityCard>
    {#snippet head()}
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h4 class="text-sm font-medium text-foreground">
          {profile.definition?.label ?? profile.name}
        </h4>
        <span class="font-mono text-xs text-muted-foreground"
          >{profile.name}</span
        >
        {#if profile.definition?.usableBy === "both"}<Badge variant="outline"
            >Both</Badge
          >{/if}{#if profile.source !== "builtin"}<Badge variant="outline"
            >{profile.source === "user" ? "Personal" : "Project"}</Badge
          >{#if !profile.local}<Badge variant="outline">Inherited</Badge
            >{/if}{/if}{#if profile.source === "project" && !profile.trusted}<Badge
            variant="warning">Needs trust</Badge
          >{/if}
      </div>
      {#if profile.definition?.whenToUse}<p
          class="line-clamp-2 text-xs text-muted-foreground"
        >
          {profile.definition.whenToUse}
        </p>{/if}
    {/snippet}
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
          label={profile.local
            ? `Edit ${profile.definition.label ?? profile.name}`
            : `Edit ${profile.definition.label ?? profile.name} (saves a ${scope} copy)`}
          disabled={!!busy}
          onclick={() => editMetadata(profile)}
        />{/if}{#if profile.definition}<IconAction
          icon={Copy}
          label={`Duplicate ${profile.name}`}
          disabled={!!busy}
          onclick={() => {
            metadata = undefined;
            openNew(profile);
          }}
        />{/if}{#if onOpenFile && profile.source !== "builtin"}<IconAction
          icon={FileText}
          label="Open profile file"
          onclick={() => onOpenFile?.(profile.path)}
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
    {#if profile.definition}
      <div class="flex flex-wrap items-center gap-2 px-3 py-2">
        {#each changeRows(profile.definition) as row (row.key)}
          <ProfileChangeChip
            {row}
            value={text(row)}
            label={row.key.startsWith("tool:")
              ? toolRow(row.key.slice(5) as ToolId).label
              : row.label}
            {context}
            usableBy={profile.definition.usableBy}
            onSave={(next) => persistChange(profile, next)}
          />
        {:else}<span class="text-xs text-muted-foreground"
            >Uses your defaults</span
          >{/each}
        <AddProfileChange
          profileLabel={profile.definition.label ?? profile.name}
          definition={profile.definition}
          {context}
          onSave={(next) => persistChange(profile, next)}
        />
      </div>
    {/if}
    {#each profile.diagnostics as diagnostic, index (index)}<SettingsInlineMessage
        tone="warning"
        text={`${diagnostic.code}: ${diagnostic.pointer}`}
        >{#snippet actions()}<Button
            size="sm"
            variant="outline"
            onclick={() => reloadProfiles(profile.name)}>Reload</Button
          >
          {#if profile.local}<Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onclick={() => {
                repairProfile = profile;
                repairOpen = true;
              }}>Repair…</Button
            >{/if}
        {/snippet}</SettingsInlineMessage
      >{/each}
    {@const launchOverride = launchModelOverride(profile)}
    {#if launchOverride}<SettingsInlineMessage
        tone="warning"
        text={`Launches use ${launchOverride.model?.modelId ?? "the profile model"}${launchOverride.reasoningLevel ? ` · ${launchOverride.reasoningLevel}` : ""} from an earlier launch setting, which outranks this profile's model.`}
        >{#snippet actions()}<Button
            size="sm"
            variant="outline"
            disabled={launchPreferences.saving}
            onclick={() => clearLaunchModel(profile)}>Use profile model</Button
          >{/snippet}</SettingsInlineMessage
      >{/if}
    {#if profile.source === "project" && profile.definition}<div
        class="flex items-center gap-2 px-3 pb-2"
      >
        <Button
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
        >
      </div>{/if}
  </EntityCard>
{/each}
{#if metadata}<ProfileEditorDialog
    definition={metadata.definition}
    onSave={saveDefinition}
    bind:open={
      () => !!metadata,
      (value) => {
        if (!value) metadata = undefined;
      }
    }
  />{/if}
{#if newDefinition && newOpen}<ProfileEditorDialog
    bind:open={newOpen}
    definition={newDefinition}
    isNew
    onSave={saveDefinition}
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
