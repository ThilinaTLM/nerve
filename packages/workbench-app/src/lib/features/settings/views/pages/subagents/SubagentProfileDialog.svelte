<!--
  Editor for one sub-agent profile file. Edits stay local until Save; the form
  module owns the conversion to the file's shorthand and the validation.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import {
  capabilityToolNameSchema,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import type { ModelInfo } from "@nervekit/contracts/models";
import {
  subagentBlockedToolNames,
  type SubagentProfileDraft,
  type SubagentProfilePatch,
  type SubagentProfileConfiguration,
} from "@nervekit/contracts/subagents";
import { thinkingLevels } from "@nervekit/contracts/models";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import type { AvailableSkill } from "$lib/api";
import { capabilityToolGroupsFor } from "$lib/presentation/composer/capability-tool-labels";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import ModelSelectionField from "../../shared/model-picker/ModelSelectionField.svelte";
import {
  deriveProfileName,
  formsEqual,
  formToDraft,
  formToPatch,
  formWithInheritedField,
  type ProfileField,
  validateForm,
  type SubagentProfileForm,
} from "./subagent-profile-form";

type Props = {
  open?: boolean;
  /** The form to edit; a new one per opening. */
  initial: SubagentProfileForm;
  scopeLabel: string;
  models: ModelInfo[];
  skills: AvailableSkill[];
  /** Names already used in this scope, for new profiles. */
  takenNames: readonly string[];
  configuration?: SubagentProfileConfiguration;
  onSave: (
    draft: SubagentProfileDraft,
    patch: SubagentProfilePatch,
  ) => Promise<void>;
};

let {
  open = $bindable(false),
  initial,
  scopeLabel,
  models,
  skills,
  takenNames,
  onSave,
  configuration,
}: Props = $props();

// svelte-ignore state_referenced_locally
let form = $state<SubagentProfileForm>(
  structuredClone($state.snapshot(initial)),
);
let saving = $state(false);
let saveError = $state<string | undefined>();
let attempted = $state(false);
let pinned = $state<ProfileField[]>([]);
let reset = $state<ProfileField[]>([]);
let chosenTools = $state<string[]>([]);
let chosenSkills = $state<string[]>([]);
let resetMaps = $state<("tools" | "skills")[]>([]);
let opening = 0;
const profileFields: ProfileField[] = [
  "label",
  "description",
  "enabled",
  "model",
  "thinking",
  "permission",
  "compaction",
  "tools",
  "skills",
  "instructions",
];
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
let openedFor: SubagentProfileForm | undefined;

$effect(() => {
  if (open && openedFor !== initial) {
    opening += 1;
    openedFor = initial;
    form = structuredClone($state.snapshot(initial));
    saving = false;
    saveError = undefined;
    attempted = false;
    pinned = [];
    reset = [];
    chosenTools = [];
    chosenSkills = [];
    resetMaps = [];
  }
  if (!open && openedFor) {
    opening += 1;
    openedFor = undefined;
  }
});

const errors = $derived(
  validateForm(form, {
    takenNames,
    resetFields: configuration ? reset : undefined,
  }),
);
const hasErrors = $derived(Object.keys(errors).length > 0);
const dirty = $derived(
  !formsEqual(form, initial) ||
    pinned.length > 0 ||
    reset.length > 0 ||
    chosenTools.length > 0 ||
    chosenSkills.length > 0 ||
    (configuration?.effective === null && configuration.local !== null),
);
const toolGroups = capabilityToolGroupsFor(
  capabilityToolNameSchema.options.filter(
    (name): name is CapabilityToolName => name !== "subagents",
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

const thinkingItems = [
  { value: "lead", label: "Lead's thinking level" },
  ...thinkingLevels.map((level) => ({ value: level, label: level })),
];
const permissionItems = [
  {
    value: "read_only",
    label: "Read-only",
    detail: "Reads files and the web; cannot change anything.",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail: "Edits files and runs commands without asking.",
  },
];
const compactionItems = [
  { value: "inherit", label: "Inherit", detail: "Use the lead's compaction" },
  { value: "profile", label: "Override", detail: "Use a profile of its own" },
];
const skillsItems = [
  { value: "inherit", label: "Same as lead" },
  { value: "none", label: "None" },
  { value: "custom", label: "Changes from lead's skills" },
];

function setLabel(value: string): void {
  pin("label");
  form.label = value;
  if (!form.nameLocked && !form.nameEdited)
    form.name = deriveProfileName(value);
}

type Delta = "same" | "on" | "off" | "custom";
const deltaItems = [
  { value: "same", label: "Inherit lower profile" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

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
  if (hasErrors || saving) return;
  const currentOpening = opening;
  saving = true;
  saveError = undefined;
  try {
    await onSave(
      formToDraft(form),
      formToPatch(form, initial, {
        pinned,
        reset,
        tools: chosenTools,
        skills: chosenSkills,
        resetMaps,
        local: configuration?.local,
        repair: configuration,
      }),
    );
    if (currentOpening === opening) open = false;
  } catch (error) {
    if (currentOpening === opening)
      saveError = error instanceof Error ? error.message : String(error);
  } finally {
    if (currentOpening === opening) saving = false;
  }
}

function shown(field: keyof typeof errors): string | undefined {
  return attempted || field === "name" ? errors[field] : undefined;
}
</script>

<Dialog
  bind:open
  size="wide"
  title={form.nameLocked
    ? `Edit ${form.label || form.name}`
    : "New sub-agent profile"}
  description={`Saved in ${scopeLabel}. The lead picks a profile by name when it assigns work.`}
>
  <div class="grid gap-6">
    {#if configuration?.effective === null && configuration.local !== null}
      <p class="text-xs text-warning">
        Repair this incomplete profile. Missing required values use the
        displayed defaults when you save; existing instructions and selections
        are retained.
      </p>
    {/if}
    {#if configuration}
      <section class="grid gap-2" aria-label="Field inheritance">
        <h3 class="text-sm font-semibold">Scope overrides</h3>
        <p class="text-xs text-muted-foreground">
          Reset inherits the lower profile, not the lead. Lead model and
          thinking are explicit choices. Pin keeps a value even when it matches
          inheritance.
        </p>
        {#each profileFields as field (field)}
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs text-muted-foreground"
              >{field}: {reset.includes(field)
                ? "will inherit lower profile"
                : pinned.includes(field)
                  ? `pinned in ${scopeLabel}`
                  : (configuration.origins.fields[field] ?? "unset")}</span
            >
            <div class="flex gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={saving}
                onclick={() => pin(field)}>Pin {field}</Button
              >
              <Button
                size="xs"
                variant="ghost"
                disabled={saving}
                onclick={() => resetField(field)}>Reset {field}</Button
              >
            </div>
          </div>
          {#if reset.includes(field)}
            <p class="break-words text-xs text-muted-foreground">
              Inherited: {JSON.stringify(
                configuration.inherited?.[field] ?? "unset",
              )}
            </p>
          {/if}
        {/each}
        {#each configuration.diagnostics as diagnostic, index (index)}
          <p
            class={diagnostic.severity === "blocking"
              ? "text-xs text-destructive"
              : "text-xs text-warning"}
          >
            {diagnostic.message}
          </p>
        {/each}
      </section>
    {/if}
    <div class="flex items-center justify-between gap-3">
      <Label for="profile-enabled">Enabled in this scope</Label>
      <Switch
        id="profile-enabled"
        size="settings"
        checked={form.enabled}
        disabled={saving}
        onCheckedChange={(value) => {
          pin("enabled");
          form.enabled = value;
        }}
      />
    </div>
    {#each Object.keys(form.tools).filter((name) => !capabilityToolNameSchema.safeParse(name).success) as name (name)}
      <p class="text-xs text-warning">
        Unknown tool {name} ({form.tools[name] === false
          ? "disabled"
          : "requested"}). Retained on save; unavailable tools are not enabled
        on the child.
      </p>
    {/each}
    {#each Object.keys(form.skills).filter((name) => !skills.some((skill) => skill.name === name)) as name (name)}
      <p class="text-xs text-warning">
        Unavailable skill {name} ({form.skills[name]
          ? "requested"
          : "disabled"}). Retained on save; unavailable skills are not loaded.
      </p>
    {/each}
    <section class="grid gap-3" aria-labelledby="profile-general">
      <h3 id="profile-general" class="text-sm font-semibold">General</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <Label for="profile-label">Label</Label>
          <Input
            id="profile-label"
            value={form.label}
            oninput={(event) => setLabel(event.currentTarget.value)}
            placeholder="Reviewer"
            disabled={saving}
          />
          {#if shown("label")}
            <p class="text-xs text-destructive" role="alert">
              {shown("label")}
            </p>
          {/if}
        </div>
        <div class="grid gap-1.5">
          <Label for="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={form.name}
            oninput={(event) => {
              form.name = event.currentTarget.value;
              form.nameEdited = true;
            }}
            placeholder="reviewer"
            disabled={saving || form.nameLocked}
          />
          {#if form.name && shown("name")}
            <p class="text-xs text-destructive" role="alert">{shown("name")}</p>
          {:else}
            <p class="text-xs text-muted-foreground">
              {form.nameLocked
                ? "The profile name cannot change."
                : "Lowercase letters, numbers and single hyphens."}
            </p>
          {/if}
        </div>
      </div>
      <div class="grid gap-1.5">
        <Label for="profile-description">Description</Label>
        <Input
          id="profile-description"
          bind:value={
            () => form.description,
            (value) => {
              form.description = value;
              pin("description");
            }
          }
          placeholder="Reviews diffs for correctness risks."
          disabled={saving}
        />
        <p class="flex justify-between text-xs text-muted-foreground">
          <span class={shown("description") ? "text-destructive" : ""}>
            {shown("description") ??
              "Shown to the lead when it picks a profile."}
          </span>
          <span class="tabular-nums">{form.description.trim().length}/200</span>
        </p>
      </div>
    </section>

    <section class="grid gap-3" aria-labelledby="profile-model">
      <h3 id="profile-model" class="text-sm font-semibold">Model</h3>
      <ModelSelectionField
        label="Model"
        {models}
        bind:model={
          () => form.model,
          (value) => {
            form.model = value;
            pin("model");
          }
        }
        bind:inherit={
          () => form.modelLead,
          (value) => {
            form.modelLead = value;
            pin("model");
          }
        }
        showReasoning={false}
        inheritOption={{
          label: "Lead's model",
          description:
            "Sub-agents start on the model of the lead that created them.",
        }}
      />
      {#if shown("model")}
        <p class="text-xs text-destructive" role="alert">{shown("model")}</p>
      {/if}
      <div class="grid gap-1.5">
        <Label>Thinking level</Label>
        <SelectField
          items={thinkingItems}
          value={form.thinking}
          ariaLabel="Thinking level"
          disabled={saving}
          onValueChange={(value) => (
            pin("thinking"),
            (form.thinking = value as SubagentProfileForm["thinking"])
          )}
        />
      </div>
    </section>

    {#if thinkingIncompatible && !reset.includes("thinking") && !reset.includes("model")}
      <p class="text-xs text-destructive" role="alert">
        This model does not support {form.thinking} thinking. Choose a supported level;
        the profile remains blocked until compatible. Your selection is preserved.
      </p>
    {/if}

    <section class="grid gap-3" aria-labelledby="profile-permissions">
      <h3 id="profile-permissions" class="text-sm font-semibold">
        Permissions
      </h3>
      <SelectField
        items={permissionItems}
        value={form.permission}
        ariaLabel="Permissions"
        disabled={saving}
        onValueChange={(value) => (
          pin("permission"),
          (form.permission = value as SubagentProfileForm["permission"])
        )}
      />
      <p class="text-xs text-muted-foreground">
        Sub-agents never ask the user, so only rule sets without prompts are
        offered.
      </p>
    </section>

    <section class="grid gap-3" aria-labelledby="profile-context">
      <h3 id="profile-context" class="text-sm font-semibold">Context</h3>
      <div class="grid gap-1.5">
        <Label>Compaction</Label>
        <SelectField
          items={compactionItems}
          value={form.compactionMode}
          ariaLabel="Compaction"
          disabled={saving}
          onValueChange={(value) => (
            pin("compaction"),
            (form.compactionMode =
              value as SubagentProfileForm["compactionMode"])
          )}
        />
      </div>
      {#if form.compactionMode === "profile"}
        <div class="flex items-center justify-between gap-3">
          <Label for="profile-compaction-auto">Auto-compact</Label>
          <Switch
            id="profile-compaction-auto"
            size="settings"
            bind:checked={
              () => form.compactionAuto,
              (value) => {
                form.compactionAuto = value;
                pin("compaction");
              }
            }
            disabled={saving}
          />
        </div>
        <SelectField
          items={compactionProfileItems}
          value={form.compactionProfile}
          ariaLabel="Compaction profile"
          disabled={saving}
          onValueChange={(value) => (
            pin("compaction"),
            (form.compactionProfile =
              value as SubagentProfileForm["compactionProfile"])
          )}
        />
        {#if form.compactionProfile === "custom"}
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="profile-trigger">Compact at (%)</Label>
              <Input
                id="profile-trigger"
                type="number"
                min={60}
                max={90}
                value={String(form.triggerPercent)}
                oninput={(event) => (
                  pin("compaction"),
                  (form.triggerPercent = Number(event.currentTarget.value))
                )}
              />
            </div>
            <div class="grid gap-1.5">
              <Label for="profile-keep">Retain recent (%)</Label>
              <Input
                id="profile-keep"
                type="number"
                min={5}
                max={40}
                value={String(form.keepRecentPercent)}
                oninput={(event) => (
                  pin("compaction"),
                  (form.keepRecentPercent = Number(event.currentTarget.value))
                )}
              />
            </div>
          </div>
        {/if}
        {#if shown("compaction")}
          <p class="text-xs text-destructive" role="alert">
            {shown("compaction")}
          </p>
        {/if}
      {/if}
    </section>

    <section class="grid gap-3" aria-labelledby="profile-tools">
      <h3 id="profile-tools" class="text-sm font-semibold">
        Tools &amp; skills
      </h3>
      <p class="text-xs text-muted-foreground">
        Changes from the lead's tools and skills. Core tools follow the
        permissions above.
      </p>
      <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Capability tools">
        {#each toolGroups as group (group.key)}
          {@const delta = toolDelta(group.names)}
          <li class="flex items-center justify-between gap-3">
            <span class="text-sm"
              >{group.label}
              {#if configuration}<span class="text-xs text-muted-foreground">
                  · {group.names
                    .map((name) => configuration?.origins.tools[name] ?? "lead")
                    .join(", ")}</span
                >{/if}
            </span>
            <SelectField
              class="w-48"
              items={delta === "custom"
                ? [
                    ...deltaItems,
                    {
                      value: "custom",
                      label: "Custom settings",
                      disabled: true,
                    },
                  ]
                : deltaItems}
              value={delta}
              ariaLabel={`${group.label} for this profile`}
              disabled={saving}
              onValueChange={(value) => setToolDelta(group.names, value)}
            />
          </li>
        {/each}
        {#each subagentBlockedToolNames as name (name)}
          <li
            class="flex items-center justify-between gap-3 text-muted-foreground"
          >
            <span class="font-mono text-xs">{name}</span>
            <span class="inline-flex items-center gap-1 text-xs">
              <Lock class="size-3" aria-hidden="true" />Always off
            </span>
          </li>
        {/each}
      </ul>
      <div class="grid gap-1.5">
        <Label>Skills</Label>
        <SelectField
          items={skillsItems}
          value={form.skillsMode}
          ariaLabel="Skills"
          disabled={saving}
          onValueChange={(value) => (
            pin("skills"),
            (form.skillsMode = value as SubagentProfileForm["skillsMode"])
          )}
        />
      </div>
      {#if form.skillsMode === "custom"}
        {#if skillNames.length === 0}
          <p class="text-xs text-muted-foreground">No skills are available.</p>
        {:else}
          <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Skill changes">
            {#each skillNames as name (name)}
              <li class="flex items-center justify-between gap-3">
                <span class="truncate text-sm"
                  >{name}
                  {#if configuration}<span
                      class="text-xs text-muted-foreground"
                    >
                      · {configuration.origins.skills[name] ?? "lead"}</span
                    >{/if}
                </span>
                <SelectField
                  class="w-48"
                  items={deltaItems}
                  value={skillDelta(name)}
                  ariaLabel={`${name} for this profile`}
                  disabled={saving}
                  onValueChange={(value) => setSkillDelta(name, value)}
                />
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    <section class="grid gap-3" aria-labelledby="profile-instructions">
      <h3 id="profile-instructions" class="text-sm font-semibold">
        Instructions
      </h3>
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
        class="min-h-40"
        placeholder="Markdown added to the sub-agent's system prompt."
        disabled={saving}
      />
      {#if shown("instructions")}
        <p class="text-xs text-destructive" role="alert">
          {shown("instructions")}
        </p>
      {/if}
    </section>

    {#if saveError}
      <p class="text-sm text-destructive" role="alert">{saveError}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      onclick={() => (open = false)}
      disabled={saving}>Cancel</Button
    >
    <Button
      size="sm"
      onclick={() => void save()}
      disabled={saving ||
        (attempted && hasErrors) ||
        (form.nameLocked && !dirty)}>{saving ? "Saving…" : "Save"}</Button
    >
  {/snippet}
</Dialog>
