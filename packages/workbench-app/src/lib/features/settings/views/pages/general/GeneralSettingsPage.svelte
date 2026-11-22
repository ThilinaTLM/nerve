<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
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
import { projectColumns } from "../../../state/project-columns.svelte";
import { CreationPreferencesState } from "../../../state/creation-preferences.svelte";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import {
  LayerRow,
  SettingsSection,
  SplitColumns,
  type SettingsLayer,
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
  projectId,
  projectName,
  models = [],
  authProviders = [],
  onReviewTrust,
}: {
  /** The open project; without one the page has a single (User) column. */
  projectId?: string;
  projectName?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  /** Opens the project's Trust page. */
  onReviewTrust?: () => void;
  settingsDraft?: Settings;
} = $props();
const layered = $derived(!!projectId && !!projectName);
/** The project's column is shown next to User (header switch); otherwise the page is User-only. */
const columns = $derived(layered && projectColumns.general);
const clamp = (model: ModelSelection, level: ThinkingLevel) => {
  const known = models.find((m) => modelKey(m) === modelKey(model));
  return known ? clampThinkingLevelForModel(level, known) : level;
};
const userState = new ScopedAgentState(clamp);
const projectState = new ScopedAgentState(clamp);
const userPrefs = new CreationPreferencesState();
const projectPrefs = new CreationPreferencesState();
let repairOpen = $state<Record<"user" | "project", boolean>>({
  user: false,
  project: false,
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void models;
  void userState.load({ scope: "user" });
  void userPrefs.load({ scope: "user" });
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !projectId) return;
  void models;
  void projectState.load({ scope: "project", projectId });
  void projectPrefs.load({ scope: "project", projectId });
  void permissionRuleSetCatalog.ensure(projectId);
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  ensureProfilesFor(projectId ? "project" : "user", projectId);
});
$effect(() => userState.observe());
$effect(() => projectState.observe());
$effect(() => userPrefs.observe());
$effect(() => projectPrefs.observe());

type Layer = SettingsLayer;
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
const states = { user: userState, project: projectState } as const;
const prefs = { user: userPrefs, project: projectPrefs } as const;
function creationOf(layer: Layer) {
  const result = prefs[layer].result;
  return result?.status === "available" ? result : undefined;
}
/** What applies at the layer. */
const valuesOf = (layer: Layer) =>
  states[layer].resolution
    ? display(
        states[layer].resolution.settings,
        creationOf(layer)?.effective.defaultAgentProfile,
      )
    : undefined;
const userValues = $derived(valuesOf("user"));
/** The project column: a locked (untrusted) file shows User's values. */
const locked = $derived(
  layered &&
    projectState.document?.status === "available" &&
    projectState.document.trusted === false,
);
const projectValues = $derived(locked ? userValues : valuesOf("project"));
const defaults = $derived(
  display(
    userState.inherited?.settings ?? {},
    userPrefs.inherited?.defaultAgentProfile,
  ),
);
const ready = $derived(!!userValues && (!layered || !!projectValues));

type Key =
  | "startProfile"
  | "model"
  | "permission"
  | "auto"
  | "strategy"
  | "percent";
const pointers: Record<Exclude<Key, "model">, string> = {
  startProfile: "/defaultAgentProfile",
  permission: "/permissionRuleSetId",
  auto: "/compaction/auto",
  strategy: "/compaction/profile",
  percent: "/compaction/customTriggerPercent",
};
function isSet(layer: Layer, key: Key): boolean {
  const overrides = states[layer].overrides;
  switch (key) {
    case "startProfile":
      return prefs[layer].overrides.defaultAgentProfile !== undefined;
    case "model":
      return (
        overrides.model !== undefined || overrides.reasoningLevel !== undefined
      );
    case "permission":
      return overrides.permissionRuleSetId !== undefined;
    case "auto":
      return overrides.compaction?.auto !== undefined;
    case "strategy":
      return overrides.compaction?.profile !== undefined;
    case "percent":
      return overrides.compaction?.customTriggerPercent !== undefined;
  }
}
type Display = ReturnType<typeof display>;
/** A comparable form of one key's value. */
function cmp(key: Key, v: Display): string {
  switch (key) {
    case "startProfile":
      return v.startProfile ?? DEFAULT_AGENT_PROFILE;
    case "model":
      return `${v.defaults.model ? modelKey(v.defaults.model) : ""}|${v.defaults.thinkingLevel}`;
    case "permission":
      return v.defaults.permissionRuleSetId;
    case "auto":
      return String(v.compaction.auto);
    case "strategy":
      return v.compaction.profile;
    case "percent":
      return String(v.compaction.customTriggerPercent);
  }
}
async function clear(layer: Layer, key: Key): Promise<void> {
  if (key === "startProfile")
    await prefs[layer].save({}, ["/overrides/defaultAgentProfile"]);
  else
    await states[layer].save(
      {},
      key === "model"
        ? ["/overrides/model", "/overrides/reasoningLevel"]
        : [`/overrides${pointers[key]}`],
    );
}
/**
 * Sets a value at a layer. A choice equal to what the layer would inherit is
 * dropped, and a User change that makes User equal the project's own choice
 * clears that choice, so nothing needs a "follow" state.
 */
async function set(
  layer: Layer,
  key: Key,
  next: Display,
  write: (layer: Layer) => Promise<void>,
): Promise<void> {
  const inheritedFrom = layer === "user" ? defaults : userValues;
  if (inheritedFrom && cmp(key, next) === cmp(key, inheritedFrom)) {
    if (isSet(layer, key)) await clear(layer, key);
  } else await write(layer);
  if (
    layer === "user" &&
    layered &&
    projectValues &&
    isSet("project", key) &&
    cmp(key, projectValues) === cmp(key, next)
  )
    await clear("project", key);
}
/** The row's value with one part replaced, for the comparison. */
const patched = (layer: Layer, patch: (v: Display) => Display) =>
  patch(
    structuredClone(
      $state.snapshot(layer === "user" ? userValues! : projectValues!),
    ),
  );

function setStartProfile(layer: Layer, defaultAgentProfile: string) {
  void set(
    layer,
    "startProfile",
    patched(layer, (v) => ({ ...v, startProfile: defaultAgentProfile })),
    (l) => prefs[l].save({ defaultAgentProfile }),
  );
}
function setModel(
  layer: Layer,
  next: { model?: ModelSelection; thinkingLevel: ThinkingLevel },
) {
  void set(
    layer,
    "model",
    patched(layer, (v) => ({
      ...v,
      defaults: {
        ...v.defaults,
        model: next.model ?? v.defaults.model,
        thinkingLevel: next.thinkingLevel,
      },
    })),
    (l) =>
      states[l].save({
        ...(next.model ? { model: next.model } : {}),
        reasoningLevel: next.thinkingLevel,
      }),
  );
}
function setPermission(layer: Layer, permissionRuleSetId: string) {
  void set(
    layer,
    "permission",
    patched(layer, (v) => ({
      ...v,
      defaults: { ...v.defaults, permissionRuleSetId },
    })),
    (l) => states[l].save({ permissionRuleSetId }),
  );
}
function setCompaction(
  layer: Layer,
  key: "auto" | "strategy" | "percent",
  compaction: Partial<Compaction>,
) {
  void set(
    layer,
    key,
    patched(layer, (v) => ({
      ...v,
      compaction: { ...v.compaction, ...compaction },
    })),
    (l) => states[l].save({ compaction }),
  );
}
function setPercent(layer: Layer, value: string) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 60 && n <= 90)
    setCompaction(layer, "percent", { customTriggerPercent: n });
}

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
function modelText(d: Defaults): string {
  const found = models.find(
    (m) => d.model && modelKey(m) === modelKey(d.model),
  );
  return found
    ? modelDisplayName(found)
    : (d.model?.modelId ?? "No model chosen");
}
function ruleSetText(id: string) {
  return ruleSets.find((r) => r.id === id)?.name ?? id;
}
function strategyText(profile: Compaction["profile"]) {
  return (
    compactionProfileItems.find((p) => p.value === profile)?.label ?? profile
  );
}
/** Reset affordances of a value row: User → built-in default, project → User. */
function resets(key: Key, text: (v: Display) => string) {
  return {
    userReset: isSet("user", key)
      ? {
          label: `Reset to default (${text(defaults)})`,
          onReset: () => void clear("user", key).then(() => clearMatching(key)),
        }
      : undefined,
    projectReset:
      columns && !locked && isSet("project", key)
        ? {
            label: `Use the User value (${text(userValues!)})`,
            onReset: () => void clear("project", key),
          }
        : undefined,
  };
}
/** The project's name on a row it overrides while its column is hidden (also while its file is untrusted). */
function overridden(key: Key): string | undefined {
  return layered && !columns && isSet("project", key) ? projectName : undefined;
}
/** After User returns to its default, drop a project choice that now equals it. */
async function clearMatching(key: Key) {
  if (
    layered &&
    userValues &&
    projectValues &&
    isSet("project", key) &&
    cmp(key, projectValues) === cmp(key, defaults)
  )
    await clear("project", key);
}
const autoAnywhere = $derived(
  !!userValues?.compaction.auto ||
    (columns && !!projectValues?.compaction.auto),
);
const customAnywhere = $derived(
  userValues?.compaction.profile === "custom" ||
    (columns && projectValues?.compaction.profile === "custom"),
);
const error = $derived(
  userState.error ??
    userPrefs.error ??
    (layered ? (projectState.error ?? projectPrefs.error) : undefined),
);
const repairs = $derived(
  (
    [
      ["user", { scope: "user" }],
      ...(projectId ? [["project", { scope: "project", projectId }]] : []),
    ] as [Layer, PreferenceScope][]
  ).filter(([layer]) => prefs[layer].result?.status === "unavailable"),
);
const reasoningConflict = $derived(
  userState.resolution?.diagnostics.some(
    (d) => d.code === "unsupported-reasoning",
  ) ||
    (layered &&
      projectState.resolution?.diagnostics.some(
        (d) => d.code === "unsupported-reasoning",
      )),
);
</script>

{#snippet splitLabels()}
  {#if projectName}<SplitColumns {projectName} {locked} />{/if}
{/snippet}

{#snippet link(text: string, page: string)}
  <button
    type="button"
    class="inline-flex items-center gap-0.5 text-primary hover:underline"
    onclick={() => void openSettingsPane(page)}
    >{text}<ArrowRight class="size-3" aria-hidden="true" /></button
  >
{/snippet}

{#snippet profileSelect(layer: Layer, value: string, disabled: boolean)}
  <div class="w-full">
    <SelectField
      disabled={disabled || prefs[layer].saving || !creationOf(layer)}
      items={profileOptions}
      {value}
      ariaLabel={layer === "user"
        ? "Start profile"
        : `Start profile in this project`}
      onValueChange={(next) => setStartProfile(layer, next)}
    />
  </div>
{/snippet}

{#snippet modelPicker(layer: Layer, v: Display, disabled: boolean)}
  <ModelPicker
    disabled={disabled || states[layer].saving}
    label={layer === "user" ? "Default model" : `Default model in this project`}
    class="w-full"
    models={usableModels}
    value={v.defaults.model}
    thinkingLevel={v.defaults.thinkingLevel}
    onChange={(next) => setModel(layer, next)}
  />
{/snippet}

{#snippet permissionSelect(layer: Layer, v: Display, disabled: boolean)}
  <div
    class="w-full"
    data-tour-id={layer === "user"
      ? "setup-agent-default-permission"
      : undefined}
  >
    <SelectField
      disabled={disabled || states[layer].saving}
      items={ruleSetOptions}
      value={v.defaults.permissionRuleSetId}
      placeholder={ruleSetText(v.defaults.permissionRuleSetId)}
      ariaLabel={layer === "user"
        ? "Default permission rule set"
        : `Default permission rule set in this project`}
      onValueChange={(next) => setPermission(layer, next)}
    />
  </div>
{/snippet}

{#snippet strategySelect(layer: Layer, v: Display, disabled: boolean)}
  <div class="w-full">
    <SelectField
      disabled={disabled || states[layer].saving}
      items={compactionProfileItems.map((item) => ({
        value: item.value,
        label: item.label,
        detail: item.detail,
      }))}
      value={v.compaction.profile}
      ariaLabel={layer === "user"
        ? "Compaction strategy"
        : `Compaction strategy in this project`}
      onValueChange={(profile) =>
        setCompaction(layer, "strategy", {
          profile: profile as Compaction["profile"],
        })}
    />
  </div>
{/snippet}

{#snippet percentInput(layer: Layer, v: Display, disabled: boolean)}
  {#if v.compaction.profile === "custom"}
    <span class="flex items-center gap-2">
      <Input
        class={columns ? "w-20" : undefined}
        disabled={disabled || states[layer].saving}
        type="number"
        min={60}
        max={90}
        step={1}
        value={String(v.compaction.customTriggerPercent)}
        aria-label={layer === "user"
          ? "Compact at percent"
          : `Compact at percent in this project`}
        oninput={(event) => setPercent(layer, event.currentTarget.value)}
      />
      <span class="flex-none text-ui text-muted-foreground">%</span>
    </span>
  {:else}
    <span class="text-caption text-muted-foreground">Only with Custom</span>
  {/if}
{/snippet}

{#if layered}
  <ProjectCapabilityTrustNotice
    document={projectState.document}
    scope={projectState.scope}
    onReload={() => projectState.reload()}
    {projectName}
    onReview={onReviewTrust}
  />
{/if}
{#if error}
  <Callout layout="block" tone="destructive" text={error}
    >{#snippet actions()}{#each repairs as [layer] (layer)}<Button
          size="sm"
          variant="outline"
          onclick={() => prefs[layer].reload()}
          >Reload defaults{layered
            ? ` (${layer === "user" ? "User" : "Project"})`
            : ""}</Button
        ><Button
          size="sm"
          variant="outline"
          onclick={() => (repairOpen[layer] = true)}
          >Preview defaults repair</Button
        >{/each}{/snippet}</Callout
  >
{/if}

{#each repairs as [layer, preferenceScope] (layer)}
  {#key JSON.stringify(preferenceScope)}<ConfigurationRepairDialog
      bind:open={repairOpen[layer]}
      target={{ document: "conversation-defaults", scope: preferenceScope }}
      replacement={{ schemaVersion: 1, revision: 0, overrides: {} }}
      onRepaired={() => prefs[layer].load(preferenceScope)}
    />{/key}
{/each}

{#if reasoningConflict}
  <Callout
    layout="block"
    tone="destructive"
    text="Reasoning conflict: the selected model does not support this explicit reasoning level. Choose a compatible model and reasoning level together."
  />
{/if}
{#if !ready}
  <Skeleton class="h-10 w-full" />
  <Skeleton class="h-10 w-full" />
{:else if userValues}
  {@const pv = projectValues ?? userValues}
  <SettingsSection
    id="new-conversations"
    title="New conversations"
    divided
    splitLabels={columns ? splitLabels : undefined}
  >
    <LayerRow
      label="Start new conversations with"
      description="The profile applied when a conversation starts. Plan approval switches to the profile set in Tools → Plan review."
      projectName={columns ? projectName : undefined}
      overriddenIn={overridden("startProfile")}
      {...resets("startProfile", (v) =>
        profileLabelFor(v.startProfile ?? DEFAULT_AGENT_PROFILE),
      )}
    >
      {#snippet user()}{@render profileSelect(
          "user",
          userValues.startProfile ?? DEFAULT_AGENT_PROFILE,
          false,
        )}{/snippet}
      {#snippet project()}{@render profileSelect(
          "project",
          pv.startProfile ?? DEFAULT_AGENT_PROFILE,
          locked,
        )}{/snippet}
    </LayerRow>
  </SettingsSection>

  <SettingsSection
    id="model"
    title="Model and permissions"
    divided
    splitLabels={columns ? splitLabels : undefined}
  >
    <LayerRow
      label="Model"
      description="The model decides which reasoning levels exist."
      projectName={columns ? projectName : undefined}
      overriddenIn={overridden("model")}
      {...resets("model", (v) => modelText(v.defaults))}
    >
      {#snippet hint()}{@render link("Model scope", "models")}{/snippet}
      {#snippet user()}{@render modelPicker(
          "user",
          userValues,
          false,
        )}{/snippet}
      {#snippet project()}{@render modelPicker("project", pv, locked)}{/snippet}
    </LayerRow>
    <LayerRow
      label="Permissions"
      description="Baseline guardrails always apply underneath."
      projectName={columns ? projectName : undefined}
      overriddenIn={overridden("permission")}
      {...resets("permission", (v) =>
        ruleSetText(v.defaults.permissionRuleSetId),
      )}
    >
      {#snippet hint()}{@render link(
          "Manage rules",
          "permission-rules",
        )}{/snippet}
      {#snippet user()}{@render permissionSelect(
          "user",
          userValues,
          false,
        )}{/snippet}
      {#snippet project()}{@render permissionSelect(
          "project",
          pv,
          locked,
        )}{/snippet}
    </LayerRow>
  </SettingsSection>

  <SettingsSection
    id="compaction"
    title="Compaction"
    description="Summarizes long conversations between agent iterations instead of stopping at the context limit."
    divided
    splitLabels={columns ? splitLabels : undefined}
  >
    <LayerRow
      label="Auto-compact"
      projectName={columns ? projectName : undefined}
      overriddenIn={overridden("auto")}
      {...resets("auto", (v) => (v.compaction.auto ? "On" : "Off"))}
    >
      {#snippet user()}<Switch
          disabled={userState.saving}
          checked={userValues.compaction.auto}
          aria-label="Auto-compact"
          onCheckedChange={(auto) => setCompaction("user", "auto", { auto })}
        />{/snippet}
      {#snippet project()}<Switch
          disabled={locked || projectState.saving}
          checked={pv.compaction.auto}
          aria-label="Auto-compact in this project"
          onCheckedChange={(auto) => setCompaction("project", "auto", { auto })}
        />{/snippet}
    </LayerRow>
    {#if autoAnywhere}
      <LayerRow
        label="Compaction strategy"
        description="Every strategy keeps about 10,000 tokens of recent messages."
        projectName={columns ? projectName : undefined}
        overriddenIn={overridden("strategy")}
        {...resets("strategy", (v) => strategyText(v.compaction.profile))}
      >
        {#snippet user()}{@render strategySelect(
            "user",
            userValues,
            false,
          )}{/snippet}
        {#snippet project()}{@render strategySelect(
            "project",
            pv,
            locked,
          )}{/snippet}
      </LayerRow>
      {#if customAnywhere}
        <LayerRow
          label="Compact at"
          description="60–90% of the context used."
          projectName={columns ? projectName : undefined}
          overriddenIn={overridden("percent")}
          {...resets("percent", (v) => `${v.compaction.customTriggerPercent}%`)}
        >
          {#snippet user()}{@render percentInput(
              "user",
              userValues,
              false,
            )}{/snippet}
          {#snippet project()}{@render percentInput(
              "project",
              pv,
              locked,
            )}{/snippet}
        </LayerRow>
      {/if}
    {/if}
  </SettingsSection>
{/if}
