<!--
  Full-page editor for one sub-agent profile in one layer (User or Project).
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
import type { ModelInfo } from "@nervekit/contracts/models";
import {
  builtInSubagentProfiles,
  SUBAGENT_INSTRUCTIONS_MAX_BYTES,
  SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  utf8ByteLength,
  type SubagentProfileConfiguration,
  type SubagentProfileDraft,
  type SubagentProfilePatch,
  type SubagentProfileSource,
} from "@nervekit/contracts/subagents";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { cn } from "@nervekit/ui-kit/utils";
import type { AvailableSkill } from "$lib/api";
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
} from "$lib/presentation/subagents/profile-layers";
import ModelPicker from "../../shared/model-picker/ModelPicker.svelte";
import {
  deriveProfileName,
  formsEqual,
  formToDraft,
  formToPatch,
  formWithInheritedField,
  localEntryAfterSave,
  validateForm,
  type SubagentProfileForm,
} from "./subagent-profile-form";
import { profileDiagnosticSummary } from "./subagent-profile-rows";

type Props = {
  mode: "create" | "edit";
  initial: SubagentProfileForm;
  configuration?: SubagentProfileConfiguration;
  scope: "user" | "project";
  filePath: string;
  models: ModelInfo[];
  skills: AvailableSkill[];
  /** Profile names visible in this scope. */
  takenNames: readonly string[];
  /** The file changed on disk since the editor opened. */
  conflict?: boolean;
  /** Throws on failure; the error is shown in the save bar. */
  onSave: (
    draft: SubagentProfileDraft,
    patch: SubagentProfilePatch,
  ) => Promise<void>;
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

const clone = (value: SubagentProfileForm): SubagentProfileForm =>
  structuredClone($state.snapshot(value)) as SubagentProfileForm;

// svelte-ignore state_referenced_locally
let form = $state<SubagentProfileForm>(clone(initial));
/** The saved state the form is compared against; follows `initial`. */
// svelte-ignore state_referenced_locally
let baseline = $state<SubagentProfileForm>(clone(initial));
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
  builtInSubagentProfiles.find((profile) => profile.name === clashName),
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
  form.modelLead
    ? undefined
    : models.find(
        (model) =>
          model.provider === form.model?.provider &&
          model.modelId === form.model?.modelId,
      ),
);
const thinkingIncompatible = $derived(
  form.thinking !== "lead" &&
    selectedModel !== undefined &&
    !selectedModel.supportedThinkingLevels.includes(form.thinking),
);
const instructionBytes = $derived(utf8ByteLength(form.instructions));

const layerBadges: Record<SubagentProfileSource, BadgeVariant> = {
  builtin: "neutral",
  user: "info",
  project: "success",
  conversation: "outline",
};
const permissionItems = [
  {
    value: "read_only",
    label: "Read-only",
    detail: "Reads files and the web; changes nothing",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail: "Edits files and runs commands without asking",
  },
];
const deltaItems = [
  { value: "same", label: "Same as lead" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];
const skillsModeItems = [
  { value: "inherit", label: "Same as lead" },
  { value: "none", label: "None" },
  { value: "custom", label: "Choose skills" },
];
const compactionItems = [
  { value: "inherit", label: "Same as lead" },
  { value: "profile", label: "Custom" },
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

/** "Same model as lead" covers both model and thinking. */
function setModelLead(value: boolean): void {
  pin("model");
  pin("thinking");
  form.modelLead = value;
  if (value) form.thinking = "lead";
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
        text="subagents.json changed on disk. Your edits are kept, but saving may be refused until you reopen the profile."
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
      info="The lead reads “When to use” to pick a profile. The model is fixed when a sub-agent starts."
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

        <SettingsToggleRow
          label="Same model as lead"
          description="Start on the lead's model and thinking level."
          checked={form.modelLead}
          disabled={saving}
          onCheckedChange={setModelLead}
        >
          {#snippet badges()}{#if revertable("model") || revertable("thinking")}
              <IconAction
                icon={RotateCcw}
                label="Revert model and thinking"
                disabled={saving}
                onclick={() => {
                  if (revertable("model")) resetField("model");
                  if (revertable("thinking")) resetField("thinking");
                }}
              />
            {/if}{/snippet}
        </SettingsToggleRow>
        {#if !form.modelLead}
          <SettingsRow label="Model" layout="responsive">
            {#snippet control()}
              <ModelPicker
                label="Model"
                class="w-full sm:w-72"
                {models}
                value={form.model}
                thinkingLevel={form.thinking === "lead"
                  ? undefined
                  : form.thinking}
                disabled={saving}
                onChange={(next) => {
                  pin("model");
                  pin("thinking");
                  form.model = next.model;
                  form.thinking = next.thinkingLevel;
                }}
              />
            {/snippet}
            {@render error("model")}
            {#if thinkingIncompatible && !reset.includes("thinking") && !reset.includes("model")}
              <p class="col-span-full text-xs text-destructive" role="alert">
                This model doesn't support {form.thinking} thinking. Pick a supported
                level; the profile can't be used until they match.
              </p>
            {/if}
          </SettingsRow>
        {/if}

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
            SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
            `${form.description.trim().length} / ${SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH} characters`,
          )}
          {@render error("description")}
        </SettingsRow>

        {#if !creating}
          <SettingsToggleRow
            label="Available to the lead"
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
      id="profile-access"
      title="Access"
      info="Sub-agents never ask for approval, and can't ask questions, present plans or start their own sub-agents."
    >
      <SettingsGroup>
        <SettingsRow label="Permission" layout="stacked">
          {#snippet badges()}{@render revert(
              "permission",
              "permission",
            )}{/snippet}
          <SettingsChoiceCards
            items={permissionItems}
            variant="radio"
            value={form.permission}
            ariaLabel="Permission"
            disabled={saving}
            onValueChange={(value) => {
              pin("permission");
              form.permission = value as SubagentProfileForm["permission"];
            }}
          />
        </SettingsRow>
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
                form.skillsMode = value as SubagentProfileForm["skillsMode"];
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
      info="Changes from the lead's tools. File, shell and search tools follow the permission."
    >
      {#snippet actions()}{@render revert("tools", "tools")}{/snippet}
      {#each toolGroups as group (group.key)}
        {@const delta = toolDelta(group.names)}
        <SettingsRow label={group.label}>
          {#snippet control()}
            {#if delta === "custom"}
              <Badge
                variant="outline"
                title="Edit subagents.json to change these settings"
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
      info="Markdown added to the sub-agent's system prompt. The lead's assignment comes on top."
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
        SUBAGENT_INSTRUCTIONS_MAX_BYTES,
        `${(instructionBytes / 1024).toFixed(1)} KB of ${SUBAGENT_INSTRUCTIONS_MAX_BYTES / 1024} KB`,
      )}
      {@render error("instructions")}
    </SettingsSection>

    <SettingsSection id="profile-compaction" title="Compaction">
      {#snippet actions()}{@render revert("compaction", "compaction")}{/snippet}
      <SettingsGroup>
        <SettingsRow label="Compaction" layout="responsive">
          {#snippet control()}
            <SelectField
              items={compactionItems}
              value={form.compactionMode}
              ariaLabel="Compaction"
              class="sm:w-72"
              disabled={saving}
              onValueChange={(value) => {
                pin("compaction");
                form.compactionMode =
                  value as SubagentProfileForm["compactionMode"];
              }}
            />
          {/snippet}
        </SettingsRow>
        {#if form.compactionMode === "profile"}
          <SettingsToggleRow
            label="Auto-compact"
            checked={form.compactionAuto}
            disabled={saving}
            onCheckedChange={(value) => {
              form.compactionAuto = value;
              pin("compaction");
            }}
          />
          <SettingsRow label="Compaction profile" layout="stacked">
            <SettingsChoiceCards
              items={compactionProfileItems}
              variant="radio"
              value={form.compactionProfile}
              ariaLabel="Compaction profile"
              disabled={saving}
              onValueChange={(value) => {
                pin("compaction");
                form.compactionProfile =
                  value as SubagentProfileForm["compactionProfile"];
              }}
            />
          </SettingsRow>
          {#if form.compactionProfile === "custom"}
            <div class="grid gap-3 py-1.5 sm:grid-cols-2">
              <SettingsFieldRow
                id="profile-trigger"
                label="Compact at"
                type="number"
                min={60}
                max={90}
                step={1}
                suffix="%"
                hint="60–90% context used"
                value={String(form.triggerPercent)}
                disabled={saving}
                onValueChange={(value) => {
                  pin("compaction");
                  form.triggerPercent = Number(value);
                }}
              />
              <SettingsFieldRow
                id="profile-keep"
                label="Retain recent"
                type="number"
                min={1}
                max={40}
                step={1}
                suffix="%"
                hint="1–40% kept verbatim"
                value={String(form.keepRecentPercent)}
                disabled={saving}
                onValueChange={(value) => {
                  pin("compaction");
                  form.keepRecentPercent = Number(value);
                }}
              />
            </div>
          {/if}
        {/if}
      </SettingsGroup>
      {@render error("compaction")}
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
