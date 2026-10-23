<script lang="ts">
import { sameConfigurationSource } from "$lib/presentation/settings/configuration-source";
import ConfigurationRepairDialog from "../capabilities/ConfigurationRepairDialog.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { PreferenceScope } from "@nervekit/contracts/agent-configuration";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import { defaultSettings } from "@nervekit/contracts/settings";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { openSettingsPane } from "$lib/application/settings";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { CreationPreferencesState } from "../../../state/creation-preferences.svelte";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import ConfigurationSource from "$lib/presentation/settings/ConfigurationSource.svelte";
import {
  SettingsChangeIndicator,
  SettingsDiffBanner,
  SettingsInlineMessage,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/settings";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
} from "$lib/presentation/utils/model";
import {
  ensureProfilesFor,
  leadProfileOptions,
  profileLabelFor,
} from "../../shared/profile-options.svelte";
import { isDefaultEligible } from "../permissions/permission-rule-sets-view";
let {
  scope,
  projectId,
  models = [],
  authProviders = [],
}: {
  scope: "user" | "project";
  projectId?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  settingsDraft?: Settings;
} = $props();
const project = $derived(scope === "project");
const preferenceScope = $derived<PreferenceScope | undefined>(
  scope === "project"
    ? projectId
      ? { scope, projectId }
      : undefined
    : { scope },
);
let repairDefaultsOpen = $state(false);
const projectState = new ScopedAgentState((model, level) => {
  const known = models.find((m) => modelKey(m) === modelKey(model));
  return known ? clampThinkingLevelForModel(level, known) : level;
});
const preferences = new CreationPreferencesState();
$effect(() => {
  if (!workbenchStartupState.progressiveActive || (project && !projectId))
    return;
  void models;
  const target = project
    ? { scope: "project" as const, projectId: projectId! }
    : { scope: "user" as const };
  void projectState.load(target);
  void preferences.load(target);
  ensureProfilesFor(scope, projectId);
  if (projectId) void permissionRuleSetCatalog.ensure(projectId);
});
$effect(() => projectState.observe());
$effect(() => preferences.observe());
type Defaults = {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
  permissionRuleSetId: string;
};
type Compaction = Settings["compaction"];
function display(settings: LeadSettingsOverrides, startProfile?: string) {
  return {
    startProfile,
    defaults: {
      model: settings.model,
      thinkingLevel:
        settings.reasoningLevel ?? defaultSettings.defaultThinkingLevel,
      permissionRuleSetId:
        settings.permissionRuleSetId ??
        defaultSettings.defaultPermissionRuleSetId,
    },
    compaction: { ...defaultSettings.compaction, ...settings.compaction },
  };
}
const creation = $derived(
  preferences.result?.status === "available" ? preferences.result : undefined,
);
const values = $derived(
  projectState.resolution
    ? display(
        projectState.resolution.settings,
        creation?.effective.defaultAgentProfile,
      )
    : undefined,
);
const inherited = $derived(display(projectState.inherited?.settings ?? {}));
const overrides = $derived(projectState.overrides);
const changedKeys = $derived({
  startProfile: creation?.overrides.defaultAgentProfile !== undefined,
  model:
    overrides.model !== undefined || overrides.reasoningLevel !== undefined,
  permission: overrides.permissionRuleSetId !== undefined,
  auto: overrides.compaction?.auto !== undefined,
  strategy: overrides.compaction?.profile !== undefined,
  percent: overrides.compaction?.customTriggerPercent !== undefined,
});
type Key = keyof typeof changedKeys;
const pointers: Record<Key, string> = {
  startProfile: "/defaultAgentProfile",
  model: "/model",
  permission: "/permissionRuleSetId",
  auto: "/compaction/auto",
  strategy: "/compaction/profile",
  percent: "/compaction/customTriggerPercent",
};
const changedCount = $derived(
  Object.values(changedKeys).filter(Boolean).length,
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const ruleSets = $derived(permissionRuleSetCatalog.summaries(projectId));
const ruleSetOptions = $derived(
  ruleSets
    .filter(isDefaultEligible)
    .map((r) => ({ value: r.id, label: r.name })),
);
const profileOptions = $derived(
  leadProfileOptions().map((p) => ({ value: p.name, label: p.label })),
);
function modelText(defaults: Defaults): string {
  const found = models.find(
    (m) => defaults.model && modelKey(m) === modelKey(defaults.model),
  );
  return found
    ? modelDisplayName(found)
    : (defaults.model?.modelId ?? "No model chosen");
}
function ruleSetText(id: string) {
  return ruleSets.find((r) => r.id === id)?.name ?? id;
}
function strategyText(profile: Compaction["profile"]) {
  return (
    compactionProfileItems.find((p) => p.value === profile)?.label ?? profile
  );
}
function setStartProfile(defaultAgentProfile: string) {
  void preferences.save({ defaultAgentProfile });
}
function setModel(next: {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
}) {
  void projectState.save({
    ...(next.model ? { model: next.model } : {}),
    reasoningLevel: next.thinkingLevel,
  });
}
function setPermission(permissionRuleSetId: string) {
  void projectState.save({ permissionRuleSetId });
}
function setCompaction(compaction: Partial<Compaction>) {
  void projectState.save({ compaction });
}
function setPercent(value: string) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 60 && n <= 90)
    setCompaction({ customTriggerPercent: n });
}
function reset(key: Key) {
  if (key === "startProfile")
    void preferences.save({}, ["/overrides/defaultAgentProfile"]);
  else
    void projectState.save(
      {},
      key === "model"
        ? ["/overrides/model", "/overrides/reasoningLevel"]
        : [`/overrides${pointers[key]}`],
    );
}
async function resetAll() {
  await projectState.save({}, [
    "/overrides/model",
    "/overrides/reasoningLevel",
    "/overrides/permissionRuleSetId",
    "/overrides/compaction",
  ]);
  await preferences.save({}, ["/overrides/defaultAgentProfile"]);
}
</script>

{#snippet dot(key: Key, from: string, to: string)}
  <ConfigurationSource
    emptyLabel={key === "startProfile" ? "Inherited" : "Unavailable"}
    provenance={key === "startProfile"
      ? changedKeys.startProfile
        ? { source: scope }
        : undefined
      : projectState.resolution?.provenance[pointers[key]]}
  />
  {#if key === "model" && !sameConfigurationSource(projectState.resolution?.provenance["/model"], projectState.resolution?.provenance["/reasoningLevel"])}<ConfigurationSource
      provenance={projectState.resolution?.provenance["/reasoningLevel"]}
      modelLabel={values ? modelText(values.defaults) : undefined}
    />{/if}
  {#if changedKeys[key]}
    <SettingsChangeIndicator compact {from} {to} onReset={() => reset(key)} />
  {/if}
{/snippet}

<ProjectCapabilityTrustNotice
  document={projectState.document}
  scope={projectState.scope}
  onReload={() => projectState.reload()}
/>
{#if projectState.error || preferences.error}
  <SettingsInlineMessage
    tone="destructive"
    text={projectState.error ?? preferences.error}
    >{#snippet actions()}{#if preferenceScope && preferences.result?.status === "unavailable"}<Button
          size="sm"
          variant="outline"
          onclick={() => preferences.reload()}>Reload defaults</Button
        ><Button
          size="sm"
          variant="outline"
          onclick={() => (repairDefaultsOpen = true)}
          >Preview defaults repair</Button
        >{/if}{/snippet}</SettingsInlineMessage
  >
{/if}

{#if preferenceScope}{#key JSON.stringify(preferenceScope)}<ConfigurationRepairDialog
      bind:open={repairDefaultsOpen}
      target={{ document: "conversation-defaults", scope: preferenceScope }}
      replacement={{ schemaVersion: 1, revision: 0, overrides: {} }}
      onRepaired={() =>
        preferenceScope ? preferences.load(preferenceScope) : Promise.resolve()}
    />{/key}{/if}

{#if projectState.resolution?.diagnostics.some((d) => d.code === "unsupported-reasoning")}
  <SettingsInlineMessage
    tone="destructive"
    text="Reasoning conflict: the selected model does not support this explicit reasoning level. Choose a compatible model and reasoning level together."
  />
{/if}
{#if project && !values}
  <Skeleton class="h-10 w-full" />
  <Skeleton class="h-10 w-full" />
{:else if values}
  {#if project && changedCount > 0}
    <SettingsDiffBanner count={changedCount} onResetAll={resetAll} />
  {/if}

  <SettingsSection id="new-conversations" title="New conversations" divided>
    <SettingsRow
      label="Start new conversations with"
      description="The profile applied when a conversation starts. Plan approval switches to the profile set in Tools → Plan review."
    >
      {#snippet badges()}
        {@render dot(
          "startProfile",
          `${project ? "User" : "Default"}: ${profileLabelFor(inherited.startProfile ?? DEFAULT_AGENT_PROFILE)}`,
          `${project ? "This project" : "User"}: ${profileLabelFor(values.startProfile ?? DEFAULT_AGENT_PROFILE)}`,
        )}
      {/snippet}
      {#snippet control()}
        <div class="w-full">
          <SelectField
            disabled={preferences.saving || !creation}
            items={profileOptions}
            value={values.startProfile ?? DEFAULT_AGENT_PROFILE}
            ariaLabel="Start profile"
            onValueChange={setStartProfile}
          />
        </div>
      {/snippet}
    </SettingsRow>
  </SettingsSection>

  <SettingsSection id="model" title="Model and permissions" divided>
    <SettingsRow
      label="Model"
      description="The model decides which reasoning levels exist."
    >
      {#snippet badges()}
        {@render dot(
          "model",
          `${project ? "User" : "Default"}: ${modelText(inherited.defaults)}`,
          `${project ? "This project" : "User"}: ${modelText(values.defaults)}`,
        )}
      {/snippet}
      {#snippet hint()}
        {#if !project}
          <button
            type="button"
            class="inline-flex items-center gap-0.5 text-primary hover:underline"
            onclick={() => void openSettingsPane("models")}
            >Model scope<ArrowRight class="size-3" aria-hidden="true" /></button
          >
        {/if}
      {/snippet}
      {#snippet control()}
        <ModelPicker
          disabled={projectState.saving}
          label="Default model"
          class="w-full"
          models={usableModels}
          value={values.defaults.model}
          thinkingLevel={values.defaults.thinkingLevel}
          onChange={setModel}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow
      label="Permissions"
      description="Baseline guardrails always apply underneath."
    >
      {#snippet badges()}
        {@render dot(
          "permission",
          `${project ? "User" : "Default"}: ${ruleSetText(inherited.defaults.permissionRuleSetId)}`,
          `${project ? "This project" : "User"}: ${ruleSetText(values.defaults.permissionRuleSetId)}`,
        )}
      {/snippet}
      {#snippet hint()}
        <button
          type="button"
          class="inline-flex items-center gap-0.5 text-primary hover:underline"
          onclick={() => void openSettingsPane("permission-rules")}
          >Manage rules<ArrowRight class="size-3" aria-hidden="true" /></button
        >
      {/snippet}
      {#snippet control()}
        <div class="w-full">
          <SelectField
            disabled={projectState.saving}
            items={ruleSetOptions}
            value={values.defaults.permissionRuleSetId}
            placeholder={ruleSetText(values.defaults.permissionRuleSetId)}
            ariaLabel="Default permission rule set"
            onValueChange={setPermission}
          />
        </div>
      {/snippet}
    </SettingsRow>
  </SettingsSection>

  <SettingsSection
    id="compaction"
    title="Compaction"
    description="Summarizes long conversations between agent iterations instead of stopping at the context limit."
    divided
  >
    <SettingsRow label="Auto-compact">
      {#snippet badges()}
        {@render dot(
          "auto",
          `${project ? "User" : "Default"}: ${inherited.compaction.auto ? "On" : "Off"}`,
          `${project ? "This project" : "User"}: ${values.compaction.auto ? "On" : "Off"}`,
        )}
      {/snippet}
      {#snippet control()}
        <Switch
          disabled={projectState.saving}
          checked={values.compaction.auto}
          aria-label="Auto-compact"
          onCheckedChange={(auto) => setCompaction({ auto })}
        />
      {/snippet}
    </SettingsRow>
    {#if values.compaction.auto}
      <SettingsRow
        label="Compaction strategy"
        description="Every strategy keeps about 10,000 tokens of recent messages."
      >
        {#snippet badges()}
          {@render dot(
            "strategy",
            `${project ? "User" : "Default"}: ${strategyText(inherited.compaction.profile)}`,
            `${project ? "This project" : "User"}: ${strategyText(values.compaction.profile)}`,
          )}
        {/snippet}
        {#snippet control()}
          <div class="w-full">
            <SelectField
              disabled={projectState.saving}
              items={compactionProfileItems.map((item) => ({
                value: item.value,
                label: item.label,
                detail: item.detail,
              }))}
              value={values.compaction.profile}
              ariaLabel="Compaction strategy"
              onValueChange={(profile) =>
                setCompaction({ profile: profile as Compaction["profile"] })}
            />
          </div>
        {/snippet}
      </SettingsRow>
      {#if values.compaction.profile === "custom"}
        <SettingsRow
          label="Compact at"
          description="60–90% of the context used."
        >
          {#snippet badges()}
            {@render dot(
              "percent",
              `${project ? "User" : "Default"}: ${inherited.compaction.customTriggerPercent}%`,
              `${project ? "This project" : "User"}: ${values.compaction.customTriggerPercent}%`,
            )}
          {/snippet}
          {#snippet control()}
            <Input
              disabled={projectState.saving}
              type="number"
              min={60}
              max={90}
              step={1}
              value={String(values.compaction.customTriggerPercent)}
              aria-label="Compact at percent"
              oninput={(event) => setPercent(event.currentTarget.value)}
            />
            <span class="flex-none text-xs text-muted-foreground">%</span>
          {/snippet}
        </SettingsRow>
      {/if}
    {/if}
  </SettingsSection>
{/if}
