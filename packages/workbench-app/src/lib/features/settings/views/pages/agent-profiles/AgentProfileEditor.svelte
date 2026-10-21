<!--
  Full-page editor for one agent profile in one layer (User or Project).
  Edits stay local until Save; the form module owns the conversion to the
  layer's sparse entry and the validation. When the profile was created in a
  lower layer, fields changed in this layer offer Revert.
-->
<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import Copy from "@lucide/svelte/icons/copy";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import {
  capabilityToolNameSchema,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import {
  thinkingLevelSchema,
  type ModelInfo,
  type ModelSelection,
} from "@nervekit/contracts/models";
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import {
  builtInAgentProfiles,
  AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
  AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  utf8ByteLength,
  type AgentProfileConfiguration,
  type AgentProfileDraft,
  type AgentProfilePatch,
  type AgentProfileScalarKind,
  type AgentProfileSource,
  type AgentProfileUsableBy,
} from "@nervekit/contracts/agent-profiles";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { cn } from "@nervekit/ui-kit/utils";
import type { AvailableSkill, ThinkingLevel } from "$lib/api";
import { capabilityToolGroupsFor } from "$lib/presentation/composer/capability-tool-labels";
import {
  SettingsChoiceCards,
  SettingsFieldRow,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import {
  profileCreatedHere,
  profileFieldValueLabel,
  profileLayerLabels,
  profileOriginLayer,
  type ProfileField,
} from "$lib/presentation/agent-profiles/profile-layers";
import ModelPicker from "../../shared/model-picker/ModelPicker.svelte";
import {
  defaultCompactionValue,
  deriveProfileName,
  formsEqual,
  formToDraft,
  formToPatch,
  formWithInheritedField,
  localEntryAfterSave,
  validateForm,
  type AgentProfileForm,
  type CompactionValue,
} from "./agent-profile-form";
import { profileDiagnosticSummary } from "./agent-profile-rows";

type Props = {
  mode: "create" | "edit";
  initial: AgentProfileForm;
  configuration?: AgentProfileConfiguration;
  scope: "user" | "project";
  filePath: string;
  models: ModelInfo[];
  /** Rule sets a profile can set or lock. */
  permissionRuleSets: readonly PermissionRuleSetSummary[];
  skills: AvailableSkill[];
  /** Profile names visible in this scope. */
  takenNames: readonly string[];
  /** The file changed on disk since the editor opened. */
  conflict?: boolean;
  /** Throws on failure; the error is shown in the save bar. */
  onSave: (draft: AgentProfileDraft, patch: AgentProfilePatch) => Promise<void>;
  onBack: () => void;
  onEditExisting?: (name: string) => void;
  onDuplicate?: () => void;
  onResetCustomizations?: () => void;
  onDelete?: () => void;
};

let {
  mode,
  initial,
  configuration,
  scope,
  filePath,
  models,
  permissionRuleSets,
  skills,
  takenNames,
  conflict = false,
  onSave,
  onBack,
  onEditExisting,
  onDuplicate,
  onResetCustomizations,
  onDelete,
}: Props = $props();

const clone = (value: AgentProfileForm): AgentProfileForm =>
  structuredClone($state.snapshot(value)) as AgentProfileForm;

// svelte-ignore state_referenced_locally
let form = $state<AgentProfileForm>(clone(initial));
/** The saved state the form is compared against; follows `initial`. */
// svelte-ignore state_referenced_locally
let baseline = $state<AgentProfileForm>(clone(initial));
let saving = $state(false);
let saveError = $state<string | undefined>();
let attempted = $state(false);
let pinned = $state<ProfileField[]>([]);
let reset = $state<ProfileField[]>([]);
let chosenTools = $state<string[]>([]);
let chosenSkills = $state<string[]>([]);
let resetMaps = $state<("tools" | "skills")[]>([]);
let confirmLeave = $state(false);
let pendingLeave: (() => void) | undefined;
let opening = 0;
// svelte-ignore state_referenced_locally
let openedFor = initial;

function clearChoices(): void {
  pinned = [];
  reset = [];
  chosenTools = [];
  chosenSkills = [];
  resetMaps = [];
}

$effect(() => {
  if (initial === openedFor) return;
  openedFor = initial;
  opening += 1;
  form = clone(initial);
  baseline = clone(initial);
  saving = false;
  saveError = undefined;
  attempted = false;
  clearChoices();
});

const creating = $derived(mode === "create");
/** Customizing a profile created in a lower layer: changed fields offer Revert. */
const customizing = $derived(
  !creating &&
    configuration !== undefined &&
    !profileCreatedHere(configuration, scope),
);
const originLayer = $derived(
  configuration ? profileOriginLayer(configuration, scope) : scope,
);
/** The lead-facing name, shown only when the label doesn't already imply it. */
const nameDetail = $derived(
  !creating && baseline.name !== deriveProfileName(baseline.label)
    ? baseline.name
    : undefined,
);
const repairing = $derived(
  configuration?.effective === null && configuration.local !== null,
);

const patch = $derived(
  formToPatch(form, baseline, {
    pinned,
    reset,
    tools: chosenTools,
    skills: chosenSkills,
    resetMaps,
    local: configuration?.local,
    repair: configuration,
  }),
);
const localAfter = $derived(localEntryAfterSave(configuration?.local, patch));

const errors = $derived(
  validateForm(form, {
    takenNames,
    resetFields: configuration ? reset : undefined,
  }),
);
const errorCount = $derived(Object.keys(errors).length);
const dirty = $derived(
  !formsEqual(form, baseline) ||
    pinned.length > 0 ||
    reset.length > 0 ||
    chosenTools.length > 0 ||
    chosenSkills.length > 0 ||
    repairing,
);
const canSave = $derived(
  !saving && !(attempted && errorCount > 0) && (creating || dirty),
);

const clashName = $derived(
  !form.nameLocked && takenNames.includes(form.name.trim())
    ? form.name.trim()
    : undefined,
);
const clashBuiltIn = $derived(
  builtInAgentProfiles.find((profile) => profile.name === clashName),
);

const toolGroups = capabilityToolGroupsFor(
  capabilityToolNameSchema.options.filter(
    (name): name is CapabilityToolName => name !== "subagents",
  ),
);
const unknownTools = $derived(
  Object.keys(form.tools).filter(
    (name) => !capabilityToolNameSchema.safeParse(name).success,
  ),
);
const unavailableSkills = $derived(
  Object.keys(form.skills).filter(
    (name) => !skills.some((skill) => skill.name === name),
  ),
);
const skillNames = $derived(
  [
    ...new Set([
      ...skills.map((skill) => skill.name),
      ...Object.keys(form.skills),
    ]),
  ].toSorted(),
);

const selectedModel = $derived(
  form.model.value === "default"
    ? undefined
    : models.find(
        (model) =>
          model.provider === (form.model.value as ModelSelection).provider &&
          model.modelId === (form.model.value as ModelSelection).modelId,
      ),
);
const thinkingIncompatible = $derived(
  form.model.kind !== "inherit" &&
    form.thinking.kind !== "inherit" &&
    form.thinking.value !== "default" &&
    selectedModel !== undefined &&
    !selectedModel.supportedThinkingLevels.includes(form.thinking.value),
);
const instructionBytes = $derived(utf8ByteLength(form.instructions));

const layerBadges: Record<AgentProfileSource, BadgeVariant> = {
  builtin: "neutral",
  user: "info",
  project: "success",
  conversation: "outline",
};
const usableByItems: { value: AgentProfileUsableBy; label: string }[] = [
  { value: "lead", label: "Main agent" },
  { value: "subagent", label: "Sub-agents" },
  { value: "both", label: "Main agent and sub-agents" },
];
const scalarKindItems: { value: AgentProfileScalarKind; label: string }[] = [
  { value: "inherit", label: "Inherit" },
  { value: "set", label: "Set" },
  { value: "lock", label: "Lock" },
];
const thinkingItems = [
  { value: "default", label: "Default" },
  ...thinkingLevelSchema.options.map((level) => ({
    value: level,
    label: level.charAt(0).toUpperCase() + level.slice(1),
  })),
];
const permissionItems = $derived.by(() => {
  const items = permissionRuleSets
    .filter((ruleSet) => ruleSet.id !== "baseline" && ruleSet.enabled)
    .map((ruleSet) => ({ value: ruleSet.id, label: ruleSet.name }));
  const current = form.permission.value;
  if (current !== "default" && !items.some((item) => item.value === current))
    items.push({ value: current, label: current });
  return [{ value: "default", label: "Default" }, ...items];
});
const compactionValueItems = [
  { value: "default", label: "Default" },
  { value: "custom", label: "Configure" },
];
const deltaItems = [
  { value: "same", label: "Inherit" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];
const skillsModeItems = [
  { value: "inherit", label: "Inherit" },
  { value: "none", label: "None" },
  { value: "custom", label: "Choose skills" },
];
function isLocal(field: ProfileField): boolean {
  return Object.hasOwn(localAfter, field);
}

function valueLabel(field: ProfileField, value: unknown): string {
  return profileFieldValueLabel(field, value, models) || "Empty";
}

/** Revert is offered only for fields this layer sets on a customized profile. */
function revertable(field: ProfileField): boolean {
  return customizing && isLocal(field);
}

function revertLabel(field: ProfileField, title: string): string {
  const inherited = configuration?.inherited?.[field];
  return inherited === undefined
    ? `Revert ${title}`
    : `Revert ${title} to ${valueLabel(field, inherited)}`;
}

function pin(field: ProfileField): void {
  pinned = [...new Set([...pinned, field])];
  reset = reset.filter((item) => item !== field);
}

function resetField(field: ProfileField): void {
  form = formWithInheritedField(form, field, configuration?.inherited ?? null);
  if (field === "tools" || field === "skills") {
    resetMaps = [...new Set([...resetMaps, field])];
    if (field === "tools") chosenTools = [];
    else chosenSkills = [];
  }
  reset = [...new Set([...reset, field])];
  pinned = pinned.filter((item) => item !== field);
}

function discard(): void {
  form = clone(baseline);
  saveError = undefined;
  attempted = false;
  clearChoices();
}

/** Leaving the editor asks first when there are unsaved changes. */
function leave(action: () => void): void {
  if (dirty && !saving) {
    pendingLeave = action;
    confirmLeave = true;
  } else action();
}

type ScalarField = "model" | "thinking" | "permission" | "compaction";

function setKind(field: ScalarField, kind: AgentProfileScalarKind): void {
  pin(field);
  form[field].kind = kind;
}

function setCompaction(change: Partial<CompactionValue>): void {
  pin("compaction");
  const current = form.compaction.value;
  form.compaction.value = {
    ...(current === "default" ? defaultCompactionValue : current),
    ...change,
  };
}

function setLabel(value: string): void {
  pin("label");
  form.label = value;
  if (!form.nameLocked && !form.nameEdited)
    form.name = deriveProfileName(value);
}

type Delta = "same" | "on" | "off" | "custom";

function toolDelta(names: readonly string[]): Delta {
  const values = names.map((name) => form.tools[name]);
  if (values.some((value) => typeof value === "object")) return "custom";
  if (values.every((value) => value === true)) return "on";
  if (values.every((value) => value === false)) return "off";
  return "same";
}

function setToolDelta(names: readonly string[], delta: string): void {
  reset = reset.filter((field) => field !== "tools");
  chosenTools = [...new Set([...chosenTools, ...names])];
  const tools = { ...form.tools };
  for (const name of names) {
    if (delta === "on") tools[name] = true;
    else if (delta === "off") tools[name] = false;
    else delete tools[name];
  }
  form.tools = tools;
}

function skillDelta(name: string): Delta {
  const value = form.skills[name];
  return value === true ? "on" : value === false ? "off" : "same";
}

function setSkillDelta(name: string, delta: string): void {
  reset = reset.filter((field) => field !== "skills");
  chosenSkills = [...new Set([...chosenSkills, name])];
  const skillMap = { ...form.skills };
  if (delta === "on") skillMap[name] = true;
  else if (delta === "off") skillMap[name] = false;
  else delete skillMap[name];
  form.skills = skillMap;
}

async function save(): Promise<void> {
  attempted = true;
  if (errorCount > 0 || saving || (!creating && !dirty)) return;
  const currentOpening = opening;
  const saved = clone(form);
  saving = true;
  saveError = undefined;
  try {
    await onSave(formToDraft(form), patch);
    // The parent normally supplies a fresh `initial`; until then the saved
    // form is the new baseline.
    if (currentOpening === opening) {
      baseline = saved;
      attempted = false;
      clearChoices();
    }
  } catch (error) {
    if (currentOpening === opening)
      saveError = error instanceof Error ? error.message : String(error);
  } finally {
    if (currentOpening === opening) saving = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (
    event.key.toLowerCase() === "s" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !confirmLeave
  ) {
    event.preventDefault();
    void save();
  }
}

function shown(field: keyof typeof errors): string | undefined {
  return attempted || field === "name" ? errors[field] : undefined;
}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet revert(field: ProfileField, title: string)}
  {#if revertable(field)}
    <IconAction
      icon={RotateCcw}
      label={revertLabel(field, title)}
      disabled={saving}
      onclick={() => resetField(field)}
    />
  {/if}
{/snippet}

{#snippet kindSelect(field: ScalarField, title: string)}
  <SelectField
    items={scalarKindItems}
    value={form[field].kind}
    ariaLabel={`${title}: inherit, set or lock`}
    class="w-28"
    disabled={saving}
    onValueChange={(value) => setKind(field, value as AgentProfileScalarKind)}
  />
{/snippet}

{#snippet error(field: keyof typeof errors)}
  {#if shown(field)}
    <p class="col-span-full text-xs text-destructive" role="alert">
      {shown(field)}
    </p>
  {/if}
{/snippet}

{#snippet usage(used: number, max: number, text: string)}
  {#if used > max * 0.8}
    <p
      class={cn(
        "col-span-full text-xs tabular-nums text-muted-foreground",
        used > max && "text-destructive",
      )}
    >
      {text}
    </p>
  {/if}
{/snippet}

<div class="flex min-h-full flex-col">
  <div class="mx-auto grid w-full max-w-3xl flex-1 content-start gap-6 pb-8">
    <header class="flex min-w-0 items-center gap-2">
      <IconAction
        icon={ChevronLeft}
        label="Back to profiles"
        onclick={() => leave(onBack)}
      />
      <h3 class="truncate text-base font-semibold text-foreground">
        {creating ? "New profile" : baseline.label || baseline.name}
      </h3>
      {#if nameDetail}
        <span class="truncate text-xs text-muted-foreground">{nameDetail}</span>
      {/if}
      {#if !creating}
        <Badge variant={layerBadges[originLayer]}
          >{profileLayerLabels[originLayer]}</Badge
        >
      {/if}
      {#if onDuplicate || onResetCustomizations || onDelete}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "ml-auto",
            )}
            aria-label="Profile actions"
            title="Profile actions"
          >
            <Ellipsis class="size-3.5" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="w-56">
            {#if onDuplicate}
              <DropdownMenu.Item onSelect={() => leave(() => onDuplicate?.())}>
                <Copy aria-hidden="true" />Duplicate as new profile
              </DropdownMenu.Item>
            {/if}
            {#if onResetCustomizations}
              <DropdownMenu.Item onSelect={() => onResetCustomizations?.()}>
                <RotateCcw aria-hidden="true" />Reset customizations
              </DropdownMenu.Item>
            {/if}
            {#if onDelete}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                variant="destructive"
                onSelect={() => onDelete?.()}
              >
                <Trash2 aria-hidden="true" />Delete profile
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </header>

    {#if conflict}
      <SettingsInlineMessage
        tone="warning"
        text="agent-profiles.json changed on disk. Your edits are kept, but saving may be refused until you reopen the profile."
      />
    {/if}
    {#if repairing}
      <SettingsInlineMessage
        tone="warning"
        text="This profile is incomplete. Missing values use the defaults shown here when you save."
      />
    {/if}
    {#each configuration?.diagnostics ?? [] as diagnostic, index (index)}
      <SettingsInlineMessage
        tone={diagnostic.severity === "blocking" ? "destructive" : "warning"}
        text={profileDiagnosticSummary(diagnostic)}
      />
    {/each}
    {#each unknownTools as name (name)}
      <SettingsInlineMessage
        tone="warning"
        text={`Unknown tool ${name} is kept but not enabled.`}
      />
    {/each}
    {#each unavailableSkills as name (name)}
      <SettingsInlineMessage
        tone="warning"
        text={`Skill ${name} isn't available and won't be loaded.`}
      />
    {/each}

    <SettingsSection
      id="profile-general"
      title="General"
      info="“When to use” tells agents and users when this profile fits. The main agent reads it to choose a sub-agent profile."
    >
      <SettingsGroup>
        <SettingsRow label="Label" htmlFor="profile-label" layout="responsive">
          {#snippet badges()}{@render revert("label", "label")}{/snippet}
          {#snippet control()}
            <Input
              id="profile-label"
              class="sm:w-72"
              value={form.label}
              oninput={(event) => setLabel(event.currentTarget.value)}
              placeholder="Reviewer"
              disabled={saving}
            />
          {/snippet}
          {@render error("label")}
        </SettingsRow>

        {#if !form.nameLocked}
          <SettingsRow
            label="Name"
            description="How the lead refers to it. Can't be changed later."
            htmlFor="profile-name"
            layout="responsive"
          >
            {#snippet control()}
              <Input
                id="profile-name"
                class={cn("sm:w-72", clashName && "border-warning")}
                value={form.name}
                oninput={(event) => {
                  form.name = event.currentTarget.value;
                  form.nameEdited = true;
                }}
                placeholder="reviewer"
                disabled={saving}
              />
            {/snippet}
            {#if clashName}
              <p class="col-span-full text-xs text-warning" role="alert">
                {clashName} already exists.
                {#if onEditExisting}
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-xs"
                    onclick={() =>
                      leave(() => onEditExisting?.(clashName ?? ""))}
                    >{clashBuiltIn
                      ? `Customize ${clashBuiltIn.label} instead`
                      : `Edit ${clashName} instead`}</Button
                  >
                {/if}
              </p>
            {:else if form.name}
              {@render error("name")}
            {/if}
          </SettingsRow>
        {/if}

        <SettingsRow
          label="Usable by"
          description="Where this profile can be selected."
          layout="responsive"
        >
          {#snippet badges()}{@render revert(
              "usableBy",
              "availability",
            )}{/snippet}
          {#snippet control()}
            <SelectField
              items={usableByItems}
              value={form.usableBy}
              ariaLabel="Usable by"
              class="sm:w-72"
              disabled={saving}
              onValueChange={(value) => {
                pin("usableBy");
                form.usableBy = value as AgentProfileUsableBy;
              }}
            />
          {/snippet}
        </SettingsRow>

        <SettingsRow
          label="When to use"
          htmlFor="profile-description"
          layout="stacked"
        >
          {#snippet badges()}{@render revert(
              "description",
              "description",
            )}{/snippet}
          <Textarea
            id="profile-description"
            class="min-h-16"
            bind:value={
              () => form.description,
              (value) => {
                form.description = value;
                pin("description");
              }
            }
            placeholder="Reviews diffs for correctness risks and returns findings with file and line."
            disabled={saving}
          />
          {@render usage(
            form.description.trim().length,
            AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
            `${form.description.trim().length} / ${AGENT_PROFILE_DESCRIPTION_MAX_LENGTH} characters`,
          )}
          {@render error("description")}
        </SettingsRow>

        {#if !creating}
          <SettingsToggleRow
            label="Enabled"
            checked={form.enabled}
            disabled={saving}
            onCheckedChange={(value) => {
              pin("enabled");
              form.enabled = value;
            }}
          >
            {#snippet badges()}{@render revert(
                "enabled",
                "availability",
              )}{/snippet}
          </SettingsToggleRow>
        {/if}
      </SettingsGroup>
    </SettingsSection>

    <SettingsSection
      id="profile-session"
      title="Model and behavior"
      info="Inherit keeps the conversation's value. Set applies it when the profile is selected, and the user can still change it. Lock applies it every turn and disables the picker."
    >
      <SettingsGroup>
        <SettingsRow label="Model" layout="responsive">
          {#snippet badges()}{@render revert("model", "model")}{/snippet}
          {#snippet control()}
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              {@render kindSelect("model", "Model")}
              {#if form.model.kind !== "inherit"}
                <ModelPicker
                  label="Model"
                  class="w-full sm:w-60"
                  {models}
                  value={form.model.value === "default"
                    ? undefined
                    : form.model.value}
                  thinkingLevel={undefined}
                  showReasoning={false}
                  disabled={saving}
                  inherit={form.model.value === "default"}
                  inheritOption={{
                    label: "Default model",
                    description: "Use the model chosen in settings.",
                  }}
                  onInherit={() => {
                    pin("model");
                    form.model.value = "default";
                  }}
                  onChange={(next) => {
                    if (!next.model) return;
                    pin("model");
                    form.model.value = next.model;
                  }}
                />
              {/if}
            </div>
          {/snippet}
          {@render error("model")}
        </SettingsRow>
        <SettingsRow label="Thinking" layout="responsive">
          {#snippet badges()}{@render revert("thinking", "thinking")}{/snippet}
          {#snippet control()}
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              {@render kindSelect("thinking", "Thinking")}
              {#if form.thinking.kind !== "inherit"}
                <SelectField
                  items={thinkingItems}
                  value={form.thinking.value}
                  ariaLabel="Thinking level"
                  class="w-40"
                  disabled={saving}
                  onValueChange={(value) => {
                    pin("thinking");
                    form.thinking.value = value as ThinkingLevel | "default";
                  }}
                />
              {/if}
            </div>
          {/snippet}
          {@render error("thinking")}
          {#if thinkingIncompatible && !reset.includes("thinking") && !reset.includes("model")}
            <p class="col-span-full text-xs text-destructive" role="alert">
              This model doesn't support {form.thinking.value} thinking. Pick a supported
              level; the profile can't be used until they match.
            </p>
          {/if}
        </SettingsRow>
        <SettingsRow label="Permission" layout="responsive">
          {#snippet badges()}{@render revert(
              "permission",
              "permission",
            )}{/snippet}
          {#snippet control()}
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              {@render kindSelect("permission", "Permission")}
              {#if form.permission.kind !== "inherit"}
                <SelectField
                  items={permissionItems}
                  value={form.permission.value}
                  ariaLabel="Permission rule set"
                  class="w-48"
                  disabled={saving}
                  onValueChange={(value) => {
                    pin("permission");
                    form.permission.value = value;
                  }}
                />
              {/if}
            </div>
          {/snippet}
          {@render error("permission")}
        </SettingsRow>
        <SettingsRow label="Compaction" layout="responsive">
          {#snippet badges()}{@render revert(
              "compaction",
              "compaction",
            )}{/snippet}
          {#snippet control()}
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              {@render kindSelect("compaction", "Compaction")}
              {#if form.compaction.kind !== "inherit"}
                <SelectField
                  items={compactionValueItems}
                  value={form.compaction.value === "default"
                    ? "default"
                    : "custom"}
                  ariaLabel="Compaction settings"
                  class="w-40"
                  disabled={saving}
                  onValueChange={(value) => {
                    pin("compaction");
                    form.compaction.value =
                      value === "default" ? "default" : defaultCompactionValue;
                  }}
                />
              {/if}
            </div>
          {/snippet}
          {@render error("compaction")}
        </SettingsRow>
        {#if form.compaction.kind !== "inherit" && form.compaction.value !== "default"}
          {@const compaction = form.compaction.value}
          <SettingsToggleRow
            label="Auto-compact"
            checked={compaction.auto}
            disabled={saving}
            onCheckedChange={(value) => setCompaction({ auto: value })}
          />
          <SettingsRow label="Compaction profile" layout="stacked">
            <SettingsChoiceCards
              items={compactionProfileItems}
              variant="radio"
              value={compaction.profile}
              ariaLabel="Compaction profile"
              disabled={saving}
              onValueChange={(value) =>
                setCompaction({
                  profile: value as CompactionValue["profile"],
                })}
            />
          </SettingsRow>
          {#if compaction.profile === "custom"}
            <div class="grid gap-3 py-1.5">
              <SettingsFieldRow
                id="profile-trigger"
                label="Compact at"
                type="number"
                min={60}
                max={90}
                step={1}
                suffix="%"
                hint="60–90% context used"
                value={String(compaction.triggerPercent)}
                disabled={saving}
                onValueChange={(value) =>
                  setCompaction({ triggerPercent: Number(value) })}
              />
            </div>
          {/if}
        {/if}
      </SettingsGroup>
    </SettingsSection>

    <SettingsSection id="profile-skills" title="Skills">
      <SettingsGroup>
        <SettingsRow label="Skills" layout="responsive">
          {#snippet badges()}{@render revert("skills", "skills")}{/snippet}
          {#snippet control()}
            <SelectField
              items={skillsModeItems}
              value={form.skillsMode}
              ariaLabel="Skills"
              class="sm:w-72"
              disabled={saving}
              onValueChange={(value) => {
                pin("skills");
                form.skillsMode = value as AgentProfileForm["skillsMode"];
              }}
            />
          {/snippet}
          {@render error("skills")}
        </SettingsRow>
      </SettingsGroup>

      {#if form.skillsMode === "custom"}
        <SettingsGroup title="Skills">
          {#each skillNames as name (name)}
            <SettingsRow label={name}>
              {#snippet control()}
                <SelectField
                  items={deltaItems}
                  value={skillDelta(name)}
                  ariaLabel={`${name} for this profile`}
                  class="w-36"
                  disabled={saving}
                  onValueChange={(value) => setSkillDelta(name, value)}
                />
              {/snippet}
            </SettingsRow>
          {:else}
            <p class="text-xs text-muted-foreground">
              No skills are available.
            </p>
          {/each}
        </SettingsGroup>
      {/if}
    </SettingsSection>

    <SettingsSection
      id="profile-tools"
      title="Tools"
      info="Changes from the conversation's tools. File, shell and search tools follow the permission."
    >
      {#snippet actions()}{@render revert("tools", "tools")}{/snippet}
      {#each toolGroups as group (group.key)}
        {@const delta = toolDelta(group.names)}
        <SettingsRow label={group.label}>
          {#snippet control()}
            {#if delta === "custom"}
              <Badge
                variant="outline"
                title="Edit agent-profiles.json to change these settings"
                >Custom settings</Badge
              >
            {:else}
              <SelectField
                items={deltaItems}
                value={delta}
                ariaLabel={`${group.label} for this profile`}
                class="w-36"
                disabled={saving}
                onValueChange={(value) => setToolDelta(group.names, value)}
              />
            {/if}
          {/snippet}
        </SettingsRow>
      {/each}
      {@render error("tools")}
    </SettingsSection>

    <SettingsSection
      id="profile-instructions"
      title="Instructions"
      info="Markdown added to the system prompt while this profile is active. For sub-agents, the assignment comes on top."
    >
      {#snippet actions()}{@render revert(
          "instructions",
          "instructions",
        )}{/snippet}
      <Textarea
        id="profile-instructions-text"
        aria-label="Instructions"
        bind:value={
          () => form.instructions,
          (value) => {
            form.instructions = value;
            pin("instructions");
          }
        }
        class="min-h-48"
        placeholder="e.g. You review diffs. For each finding give file:line, severity (blocker / should-fix / nit), and a suggested fix. Don't edit files."
        disabled={saving}
      />
      {@render usage(
        instructionBytes,
        AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
        `${(instructionBytes / 1024).toFixed(1)} KB of ${AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES / 1024} KB`,
      )}
      {@render error("instructions")}
    </SettingsSection>
  </div>

  <!-- The settings viewport pads its bottom by 4rem; stick to its real edge. -->
  <div
    class="sticky -bottom-16 z-10 border-t border-border bg-background pt-2.5 pb-5"
  >
    <div class="mx-auto flex w-full max-w-3xl items-center gap-3">
      <p class="m-0 min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {#if saveError}
          <span class="text-destructive" role="alert">{saveError}</span>
        {:else if attempted && errorCount > 0}
          <span class="text-destructive" role="alert"
            >Fix {errorCount}
            {errorCount === 1 ? "issue" : "issues"} before saving</span
          >
        {:else if !creating && dirty}
          <span class="text-foreground">Unsaved changes</span>
        {:else}
          Saves to <span class="font-mono">{filePath}</span>
        {/if}
      </p>
      {#if creating}
        <Button variant="ghost" disabled={saving} onclick={() => leave(onBack)}
          >Cancel</Button
        >
      {:else}
        <Button variant="ghost" disabled={saving || !dirty} onclick={discard}
          >Discard</Button
        >
      {/if}
      <Button
        disabled={!canSave}
        title="Save (Ctrl+S)"
        onclick={() => void save()}
        >{saving ? "Saving…" : creating ? "Create profile" : "Save"}</Button
      >
    </div>
  </div>
</div>

<ConfirmDialog
  bind:open={confirmLeave}
  title="Discard unsaved changes?"
  description="Your changes to this profile have not been saved."
  confirmLabel="Discard changes"
  cancelLabel="Keep editing"
  destructive
  onConfirm={() => {
    const action = pendingLeave;
    pendingLeave = undefined;
    action?.();
  }}
  onCancel={() => (pendingLeave = undefined)}
/>
