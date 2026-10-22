<!--
  Agent General at user and project level: the defaults every conversation
  starts from. Project values that differ from the user's carry a dot and ↺.
  Model and reasoning are one setting, chosen together.
-->
<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { openSettingsPane } from "$lib/application/settings";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
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
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import { ProjectSettingsState } from "../../../state/project-settings.svelte";
import {
  ensureProfilesFor,
  leadProfileOptions,
  profileLabelFor,
} from "../../shared/profile-options.svelte";
import { isDefaultEligible } from "../permissions/permission-rule-sets-view";
import type { SettingsChange } from "../settings-change";

type Props = {
  scope: "user" | "project";
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  projectId?: string;
  /** Reads the composer's live selection; owned by app composition. */
  readComposerSelection?: () => Settings["lastAgentSelection"];
  onSettingsChange?: SettingsChange;
};

let {
  scope,
  settingsDraft,
  models = [],
  authProviders = [],
  projectId,
  readComposerSelection,
  onSettingsChange,
}: Props = $props();

const project = $derived(scope === "project");
const projectState = new ProjectSettingsState();

$effect(() => {
  ensureProfilesFor(scope, project ? projectId : undefined);
  if (project && projectId) void permissionRuleSetCatalog.ensure(projectId);
});
$effect(() => {
  void projectState.load(project ? projectId : undefined);
});

type Defaults = {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
  permissionRuleSetId: string;
};
type Compaction = Settings["compaction"];
type Values = {
  startProfile: string | undefined;
  defaults: Defaults;
  compaction: Compaction;
};

const userValues = $derived<Values>({
  startProfile: settingsDraft.defaultAgentProfile,
  defaults: {
    model: settingsDraft.defaultModel,
    thinkingLevel: settingsDraft.defaultThinkingLevel,
    permissionRuleSetId: settingsDraft.defaultPermissionRuleSetId,
  },
  compaction: settingsDraft.compaction,
});
function valuesOf(source: {
  defaultAgentProfile?: string;
  defaults: Defaults;
  compaction: Compaction;
}): Values {
  return {
    startProfile: source.defaultAgentProfile,
    defaults: source.defaults,
    compaction: source.compaction,
  };
}
const result = $derived(projectState.result);
const values = $derived<Values | undefined>(
  project
    ? result
      ? valuesOf(result.effective as never)
      : undefined
    : userValues,
);
const inherited = $derived<Values>(
  project && result ? valuesOf(result.inherited as never) : userValues,
);
const overrides = $derived(result?.overrides);

// What this project changes, per setting. Model and reasoning move together.
const changedKeys = $derived({
  startProfile: project && overrides?.defaultAgentProfile !== undefined,
  model:
    project &&
    (overrides?.defaults?.model !== undefined ||
      overrides?.defaults?.thinkingLevel !== undefined),
  permission: project && overrides?.defaults?.permissionRuleSetId !== undefined,
  auto: project && overrides?.compaction?.auto !== undefined,
  strategy: project && overrides?.compaction?.profile !== undefined,
  percent: project && overrides?.compaction?.customTriggerPercent !== undefined,
});
const changedCount = $derived(
  Object.values(changedKeys).filter(Boolean).length,
);

const usableModels = $derived(
  scopedUsableModelOptions(
    authenticatedRealModelOptions(models, authProviders),
    authProviders,
    settingsDraft.scopedModels,
  ),
);
const ruleSets = $derived(
  permissionRuleSetCatalog.summaries(project ? projectId : undefined),
);
const ruleSetOptions = $derived(
  ruleSets
    .filter(isDefaultEligible)
    .map((ruleSet) => ({ value: ruleSet.id, label: ruleSet.name })),
);
const profileOptions = $derived(
  leadProfileOptions().map((profile) => ({
    value: profile.name,
    label: profile.label,
  })),
);

function modelText(defaults: Defaults): string {
  const found = defaults.model
    ? models.find((model) => modelKey(model) === modelKey(defaults.model!))
    : undefined;
  const name = found
    ? modelDisplayName(found)
    : (defaults.model?.modelId ?? "No model chosen");
  return defaults.thinkingLevel === "off"
    ? name
    : `${name} · ${defaults.thinkingLevel}`;
}
function ruleSetText(id: string): string {
  return ruleSets.find((ruleSet) => ruleSet.id === id)?.name ?? id;
}
function strategyText(profile: Compaction["profile"]): string {
  return (
    compactionProfileItems.find((item) => item.value === profile)?.label ??
    profile
  );
}

// ---- writes ---------------------------------------------------------------

function userChange(
  patch: Parameters<SettingsChange>[0],
  debounce = false,
): void {
  onSettingsChange?.(
    patch,
    debounce ? { debounceMs: 350 } : { immediate: true },
  );
}

/** Turning it on seeds the remembered selection from the composer's live one. */
function setRememberLast(checked: boolean): void {
  settingsDraft.rememberLastAgentSelection = checked;
  const last = checked ? readComposerSelection?.() : undefined;
  if (!last) {
    userChange({ rememberLastAgentSelection: checked });
    return;
  }
  settingsDraft.lastAgentSelection = last;
  userChange({
    rememberLastAgentSelection: true,
    lastAgentSelection: { ...last, model: last.model ?? null },
  });
}

function setStartProfile(name: string): void {
  if (project) void projectState.update({ defaultAgentProfile: name });
  else {
    settingsDraft.defaultAgentProfile = name;
    userChange({ defaultAgentProfile: name });
  }
}
function setModel(next: {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
}): void {
  if (project) {
    void projectState.update({
      defaults: { model: next.model, thinkingLevel: next.thinkingLevel },
    });
    return;
  }
  settingsDraft.defaultModel = next.model;
  settingsDraft.defaultThinkingLevel = next.thinkingLevel;
  userChange({
    defaultModel: next.model ?? null,
    defaultThinkingLevel: next.thinkingLevel,
  });
}
function setPermission(id: string): void {
  if (project)
    void projectState.update({ defaults: { permissionRuleSetId: id } });
  else {
    settingsDraft.defaultPermissionRuleSetId = id;
    userChange({ defaultPermissionRuleSetId: id });
  }
}
function setCompaction(patch: Partial<Compaction>, debounce = false): void {
  if (project) void projectState.update({ compaction: patch });
  else {
    Object.assign(settingsDraft.compaction, patch);
    userChange({ compaction: patch }, debounce);
  }
}
function setPercent(value: string): void {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 60 && parsed <= 90)
    setCompaction({ customTriggerPercent: parsed }, true);
}

type Key = keyof typeof changedKeys;
function resetPatch(key: Key) {
  switch (key) {
    case "startProfile":
      return { defaultAgentProfile: null };
    case "model":
      return { defaults: { model: null, thinkingLevel: null } };
    case "permission":
      return { defaults: { permissionRuleSetId: null } };
    case "auto":
      return { compaction: { auto: null } };
    case "strategy":
      return { compaction: { profile: null } };
    case "percent":
      return { compaction: { customTriggerPercent: null } };
  }
}
function reset(key: Key): void {
  void projectState.update(resetPatch(key) as never);
}
function resetAll(): void {
  void projectState.update({
    defaultAgentProfile: null,
    defaults: { model: null, thinkingLevel: null, permissionRuleSetId: null },
    compaction: { auto: null, profile: null, customTriggerPercent: null },
  } as never);
}
</script>

{#snippet dot(key: Key, from: string, to: string)}
  {#if changedKeys[key]}
    <SettingsChangeIndicator compact {from} {to} onReset={() => reset(key)} />
  {/if}
{/snippet}

{#if projectState.error}
  <SettingsInlineMessage tone="destructive" text={projectState.error} />
{/if}

{#if project && !values}
  <Skeleton class="h-10 w-full" />
  <Skeleton class="h-10 w-full" />
{:else if values}
  {#if project}
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
          `User: ${profileLabelFor(inherited.startProfile ?? DEFAULT_AGENT_PROFILE)}`,
          `This project: ${profileLabelFor(values.startProfile ?? DEFAULT_AGENT_PROFILE)}`,
        )}
      {/snippet}
      {#snippet control()}
        <div class="w-full">
          <SelectField
            items={profileOptions}
            value={values.startProfile ?? DEFAULT_AGENT_PROFILE}
            ariaLabel="Start profile"
            onValueChange={setStartProfile}
          />
        </div>
      {/snippet}
    </SettingsRow>
    {#if !project}
      <SettingsRow
        label="Remember last selection"
        description="New conversations reuse the last model, reasoning level and permissions you chose."
      >
        {#snippet control()}
          <Switch
            checked={settingsDraft.rememberLastAgentSelection}
            aria-label="Remember last selection"
            onCheckedChange={setRememberLast}
          />
        {/snippet}
      </SettingsRow>
    {/if}
  </SettingsSection>

  <SettingsSection id="model" title="Model and permissions" divided>
    <SettingsRow
      label="Model"
      description="The model decides which reasoning levels exist."
    >
      {#snippet badges()}
        {@render dot(
          "model",
          `User: ${modelText(inherited.defaults)}`,
          `This project: ${modelText(values.defaults)}`,
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
          `User: ${ruleSetText(inherited.defaults.permissionRuleSetId)}`,
          `This project: ${ruleSetText(values.defaults.permissionRuleSetId)}`,
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
          `User: ${inherited.compaction.auto ? "On" : "Off"}`,
          `This project: ${values.compaction.auto ? "On" : "Off"}`,
        )}
      {/snippet}
      {#snippet control()}
        <Switch
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
            `User: ${strategyText(inherited.compaction.profile)}`,
            `This project: ${strategyText(values.compaction.profile)}`,
          )}
        {/snippet}
        {#snippet control()}
          <div class="w-full">
            <SelectField
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
              `User: ${inherited.compaction.customTriggerPercent}%`,
              `This project: ${values.compaction.customTriggerPercent}%`,
            )}
          {/snippet}
          {#snippet control()}
            <Input
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
