<!--
  Full-page editor for one sub-agent profile in one layer (User or Project).
  Edits stay local until Save; the form module owns the conversion to the
  layer's sparse entry and the validation. When the profile was created in a
  lower layer, each field shows where its value comes from and offers Revert.
-->
<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Copy from "@lucide/svelte/icons/copy";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import Eye from "@lucide/svelte/icons/eye";
import Hammer from "@lucide/svelte/icons/hammer";
import Info from "@lucide/svelte/icons/info";
import Layers from "@lucide/svelte/icons/layers";
import Lock from "@lucide/svelte/icons/lock";
import Pencil from "@lucide/svelte/icons/pencil";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import {
  capabilityToolNameSchema,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import { thinkingLevels, type ModelInfo } from "@nervekit/contracts/models";
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
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { cn } from "@nervekit/ui-kit/utils";
import type { AvailableSkill } from "$lib/api";
import { capabilityToolGroupsFor } from "$lib/presentation/composer/capability-tool-labels";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import {
  profileCreatedHere,
  profileFieldLabel,
  profileFieldValueLabel,
  profileLayerDotClasses,
  profileLayerLabels,
  profileOriginLayer,
  profileThinkingLabel,
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
  /** "User" or the project name. */
  scopeName: string;
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
  scopeName,
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
let tab = $state<"settings" | "layers">("settings");
// svelte-ignore state_referenced_locally
let advancedOpen = $state(initial.compactionMode === "profile");
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
/** Customizing a profile created in a lower layer: fields show provenance. */
const customizing = $derived(
  !creating &&
    configuration !== undefined &&
    !profileCreatedHere(configuration, scope),
);
const scopeLabel = $derived(
  scope === "user" ? "User" : `Project · ${scopeName}`,
);
const originLayer = $derived(
  configuration ? profileOriginLayer(configuration, scope) : scope,
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
const changeCount = $derived(Object.keys(patch).length);

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

const layerStrip: readonly SubagentProfileSource[] = [
  "builtin",
  "user",
  "project",
];
const layerBadges: Record<SubagentProfileSource, BadgeVariant> = {
  builtin: "neutral",
  user: "info",
  project: "success",
  conversation: "outline",
};
const tableFields: readonly ProfileField[] = [
  "enabled",
  "label",
  "description",
  "model",
  "thinking",
  "permission",
  "tools",
  "skills",
  "compaction",
  "instructions",
];
const thinkingItems = [
  { value: "lead", label: "Same as lead" },
  ...thinkingLevels.map((level) => ({
    value: level,
    label: profileThinkingLabel(level),
  })),
];
const permissionItems = [
  {
    value: "read_only",
    label: "Read-only",
    detail: "Reads files and the web. Can't change anything.",
    icon: Eye,
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail: "Edits files and runs commands without asking.",
    icon: Hammer,
  },
];
const compactionItems = [
  { value: "inherit", label: "Same as lead" },
  { value: "profile", label: "Custom" },
];

function isLocal(field: ProfileField): boolean {
  return Object.hasOwn(localAfter, field);
}

/** Inherited fields show a dashed control while this layer leaves them alone. */
function dashed(field: ProfileField): string | undefined {
  return customizing && !isLocal(field) ? "border-dashed" : undefined;
}

/** The lower layer a field's value comes from, when it is not set here. */
function inheritedSource(
  field: ProfileField,
): SubagentProfileSource | undefined {
  const source = configuration?.origins.fields[field];
  return source && source !== scope ? source : undefined;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function valueLabel(field: ProfileField, value: unknown): string {
  return profileFieldValueLabel(field, value, models) || "Empty";
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

/** Tinted rows: set in this layer when customizing, otherwise differing from the lead. */
function toolChanged(names: readonly string[]): boolean {
  if (!customizing) return toolDelta(names) !== "same";
  const local = localAfter.tools ?? {};
  return names.some((name) => Object.hasOwn(local, name));
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

function skillChanged(name: string): boolean {
  if (!customizing) return skillDelta(name) !== "same";
  const local = localAfter.skills;
  return typeof local === "object" && Object.hasOwn(local, name);
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

{#snippet dot(layer: SubagentProfileSource)}
  <span
    class={cn("size-2 shrink-0 rounded-full", profileLayerDotClasses[layer])}
    aria-hidden="true"
  ></span>
{/snippet}

{#snippet provenance(field: ProfileField, title: string)}
  {#if customizing}
    <span
      class="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {#if isLocal(field)}
        {@render dot(scope)}
        <span>Changed here ·</span>
        <Button
          variant="link"
          size="sm"
          class="h-auto p-0"
          disabled={saving}
          onclick={() => resetField(field)}>Revert</Button
        >
      {:else if inheritedSource(field)}
        {@const source = inheritedSource(field)!}
        {@render dot(source)}
        <span>From {profileLayerLabels[source]}</span>
      {:else if configuration?.local && Object.hasOwn(configuration.local, field)}
        <span>Reverts when saved</span>
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={`${title} field options`}
          title={`${title} field options`}
          disabled={saving}
        >
          <Ellipsis class="size-3.5" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-56">
          {#if isLocal(field)}
            <DropdownMenu.Item onSelect={() => resetField(field)}>
              <RotateCcw aria-hidden="true" />Revert to inherited value
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item onSelect={() => pin(field)}>
              <Lock aria-hidden="true" />Keep this value here
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item onSelect={() => (tab = "layers")}>
            <Layers aria-hidden="true" />Show where values come from
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </span>
  {/if}
{/snippet}

{#snippet revertHint(field: ProfileField)}
  {#if customizing && isLocal(field) && configuration?.inherited?.[field] !== undefined}
    <p class="text-xs text-muted-foreground">
      Revert to {valueLabel(
        field,
        configuration.inherited[field],
      )}{inheritedSource(field)
        ? ` (from ${profileLayerLabels[inheritedSource(field)!]})`
        : ""}.
    </p>
  {/if}
{/snippet}

{#snippet error(field: keyof typeof errors)}
  {#if shown(field)}
    <p class="text-xs text-destructive" role="alert">{shown(field)}</p>
  {/if}
{/snippet}

<div class="flex min-h-full flex-col">
  <div class="mx-auto grid w-full max-w-3xl flex-1 content-start gap-5 pb-8">
    <nav
      aria-label="Breadcrumb"
      class="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
    >
      <Button
        variant="ghost"
        size="sm"
        class="-ml-1.5"
        onclick={() => leave(onBack)}
      >
        <ChevronLeft aria-hidden="true" />Sub-agents
      </Button>
      <span aria-hidden="true">/</span>
      <span class="truncate text-foreground" aria-current="page"
        >{creating ? "New profile" : baseline.label || baseline.name}</span
      >
    </nav>

    <header class="flex items-start gap-3">
      <div class="grid min-w-0 flex-1 gap-1">
        {#if creating}
          <h1 class="text-lg font-semibold">New profile</h1>
          <p
            class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
          >
            Will be saved to
            <span class="inline-flex items-center gap-1.5 text-foreground"
              >{@render dot(scope)}{scopeLabel}</span
            >,
            {scope === "user"
              ? "available in all projects."
              : "shared through the project's files."}
          </p>
        {:else}
          <h1 class="flex min-w-0 items-center gap-2 text-lg font-semibold">
            <span class="truncate">{baseline.label || baseline.name}</span>
            <Badge variant={layerBadges[originLayer]}
              >{profileLayerLabels[originLayer]}</Badge
            >
          </h1>
          <div
            class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          >
            {#if configuration}
              <span
                class="inline-flex gap-0.5"
                title="Layers that set values for this profile"
              >
                {#each layerStrip as layer (layer)}
                  {@const contributes = Object.values(
                    configuration.origins.fields,
                  ).includes(layer)}
                  <span
                    class={cn(
                      "inline-flex size-4 items-center justify-center rounded-sm text-[0.6875rem] font-semibold",
                      contributes
                        ? [profileLayerDotClasses[layer], "text-background"]
                        : "border border-border text-muted-foreground",
                      layer === scope &&
                        "ring-1 ring-foreground ring-offset-1 ring-offset-background",
                    )}
                    aria-label={`${profileLayerLabels[layer]}${contributes ? " sets values" : ""}${layer === scope ? ", editing" : ""}`}
                    >{profileLayerLabels[layer].charAt(0)}</span
                  >
                {/each}
              </span>
            {/if}
            <span class="inline-flex flex-wrap items-center gap-1.5">
              Editing
              <span class="inline-flex items-center gap-1.5 text-foreground"
                >{@render dot(scope)}{scopeLabel}</span
              >{#if customizing}. {profileLayerLabels[originLayer]} values stay unchanged.{/if}
            </span>
          </div>
        {/if}
      </div>
      {#if !creating}
        <div class="flex shrink-0 items-center gap-2">
          <Label for="profile-enabled" class="text-sm text-muted-foreground"
            >Available</Label
          >
          <Switch
            id="profile-enabled"
            checked={form.enabled}
            disabled={saving}
            aria-label="Available to the lead"
            onCheckedChange={(value) => {
              pin("enabled");
              form.enabled = value;
            }}
          />
          {#if onDuplicate || onResetCustomizations || onDelete}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class={buttonVariants({ variant: "ghost", size: "icon" })}
                aria-label="Profile actions"
                title="Profile actions"
              >
                <Ellipsis aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-56">
                {#if onDuplicate}
                  <DropdownMenu.Item
                    onSelect={() => leave(() => onDuplicate?.())}
                  >
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
        </div>
      {/if}
    </header>

    {#if conflict}
      <div
        role="alert"
        class="flex gap-2.5 rounded-md border border-warning/40 bg-warning/8 p-3"
      >
        <TriangleAlert
          class="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div class="grid gap-0.5 text-sm">
          <p class="font-medium">
            subagents.json changed while you were editing
          </p>
          <p class="text-xs text-muted-foreground">
            Your unsaved changes are kept. Saving may be refused until you go
            back and reopen the latest version.
          </p>
        </div>
      </div>
    {/if}

    {#if repairing || configuration?.diagnostics.length || unknownTools.length || unavailableSkills.length}
      <div class="grid gap-1">
        {#if repairing}
          <p class="text-xs text-warning">
            Repair this incomplete profile. Missing required values use the
            displayed defaults when you save; existing instructions and
            selections are kept.
          </p>
        {/if}
        {#each configuration?.diagnostics ?? [] as diagnostic, index (index)}
          <p
            class={cn(
              "text-xs break-words",
              diagnostic.severity === "blocking"
                ? "text-destructive"
                : "text-warning",
            )}
          >
            {profileDiagnosticSummary(diagnostic)}
          </p>
        {/each}
        {#each unknownTools as name (name)}
          <p class="text-xs text-warning">
            Unknown tool {name} ({form.tools[name] === false
              ? "disabled"
              : "requested"}). Kept on save; unavailable tools are not enabled
            on the sub-agent.
          </p>
        {/each}
        {#each unavailableSkills as name (name)}
          <p class="text-xs text-warning">
            Unavailable skill {name} ({form.skills[name]
              ? "requested"
              : "disabled"}). Kept on save; unavailable skills are not loaded.
          </p>
        {/each}
      </div>
    {/if}

    {#if creating}
      {@render settingsForm()}
    {:else}
      <Tabs.Root
        value={tab}
        onValueChange={(value) => (tab = value as typeof tab)}
      >
        <Tabs.List>
          <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
          <Tabs.Trigger value="layers">Where values come from</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="settings" class="pt-3">
          {@render settingsForm()}
        </Tabs.Content>
        <Tabs.Content value="layers" class="pt-3">
          {@render layersTable()}
        </Tabs.Content>
      </Tabs.Root>
    {/if}
  </div>

  <!-- The settings viewport pads its bottom by 4rem; stick to its real edge. -->
  <div
    class="sticky -bottom-16 z-10 border-t border-border bg-background pt-2.5 pb-5"
  >
    <div class="mx-auto flex w-full max-w-3xl items-center gap-3">
      {@render dot(scope)}
      <p class="m-0 min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {#if saveError}
          <span class="text-destructive" role="alert">{saveError}</span> ·
        {:else if attempted && errorCount > 0}
          <span class="text-destructive" role="alert"
            >Fix {errorCount}
            {errorCount === 1 ? "issue" : "issues"} before saving</span
          > ·
        {:else if !creating && dirty}
          <span class="text-foreground"
            >{changeCount > 0
              ? `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`
              : "Unsaved changes"}</span
          > ·
        {/if}
        Saves to <span class="font-mono">{filePath}</span>
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

{#snippet layersTable()}
  {#if configuration}
    <div class="grid gap-2">
      <p class="text-xs text-muted-foreground">
        Saved values per field. Inherited combines all lower layers; Result is
        what the lead uses. Unsaved changes are not shown here.
      </p>
      <div class="overflow-x-auto rounded-md border border-border bg-card">
        <table class="w-full table-fixed text-sm">
          <thead class="text-left text-xs text-muted-foreground">
            <tr class="border-b border-border">
              <th class="w-28 px-3 py-2 font-medium">Field</th>
              <th class="px-3 py-2 font-medium">Inherited</th>
              <th class="px-3 py-2 font-medium">
                <span class="inline-flex items-center gap-1.5"
                  >{@render dot(scope)}This layer</span
                >
              </th>
              <th class="px-3 py-2 font-medium">Result</th>
              <th class="w-10 px-1 py-2"
                ><span class="sr-only">Actions</span></th
              >
            </tr>
          </thead>
          <tbody>
            {#each tableFields as field (field)}
              {@const inherited = configuration.inherited?.[field]}
              {@const local = configuration.local?.[field]}
              {@const result = configuration.effective?.[field]}
              {@const resultSource = configuration.origins.fields[field]}
              {@const lowerSource = inheritedSource(field)}
              <tr class="border-b border-border last:border-b-0">
                <td class="px-3 py-1.5 align-top"
                  >{sentenceCase(profileFieldLabel(field))}</td
                >
                <td
                  class={cn(
                    "px-3 py-1.5 align-top",
                    local !== undefined && "text-muted-foreground",
                  )}
                >
                  {#if inherited === undefined}
                    <span class="text-muted-foreground">—</span>
                  {:else}
                    <span class="flex min-w-0 items-center gap-1.5">
                      {#if lowerSource}{@render dot(lowerSource)}{/if}
                      <span
                        class="truncate"
                        title={valueLabel(field, inherited)}
                        >{valueLabel(field, inherited)}</span
                      >
                    </span>
                  {/if}
                </td>
                <td class="px-3 py-1.5 align-top">
                  {#if local === undefined}
                    <span class="text-muted-foreground">—</span>
                  {:else}
                    <span
                      class="block truncate"
                      title={valueLabel(field, local)}
                      >{valueLabel(field, local)}</span
                    >
                  {/if}
                </td>
                <td class="px-3 py-1.5 align-top">
                  {#if result === undefined}
                    <span class="text-muted-foreground">—</span>
                  {:else}
                    <span class="flex min-w-0 items-center gap-1.5">
                      {#if resultSource}{@render dot(resultSource)}{/if}
                      <span class="truncate" title={valueLabel(field, result)}
                        >{valueLabel(field, result)}</span
                      >
                    </span>
                  {/if}
                </td>
                <td class="px-1 py-1 align-top">
                  {#if reset.includes(field)}
                    <span
                      class="text-xs text-muted-foreground"
                      title="Reverts when saved"
                    >
                      <RotateCcw
                        class="size-3.5"
                        aria-label="Reverts when saved"
                      />
                    </span>
                  {:else if local !== undefined && customizing}
                    <IconAction
                      icon={RotateCcw}
                      label={`Revert ${profileFieldLabel(field)}`}
                      disabled={saving}
                      onclick={() => resetField(field)}
                    />
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-muted-foreground">
        Tools and skills combine per item across layers. Conversation changes
        are not shown here.
      </p>
    </div>
  {/if}
{/snippet}

{#snippet settingsForm()}
  <div class="grid gap-8">
    {#if customizing}
      <p class="flex gap-2 text-xs text-muted-foreground">
        <Info class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span
          >Fields with a dashed outline use values from lower layers. Changing
          one saves only that field to {scopeLabel}. Use <i>Revert</i> on a field
          to undo it.</span
        >
      </p>
    {/if}

    <!-- Identity -->
    <section class="grid gap-4" aria-labelledby="profile-identity">
      <div class="grid gap-0.5">
        <h2 id="profile-identity" class="text-sm font-semibold">Identity</h2>
        <p class="text-xs text-muted-foreground">
          How you and the lead recognise this profile.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid content-start gap-1.5">
          <div class="flex min-h-6 items-center gap-2">
            <Label for="profile-label">Label</Label>
            {@render provenance("label", "Label")}
          </div>
          <Input
            id="profile-label"
            class={dashed("label")}
            value={form.label}
            oninput={(event) => setLabel(event.currentTarget.value)}
            placeholder="Reviewer"
            disabled={saving}
          />
          {@render revertHint("label")}
          {@render error("label")}
        </div>
        <div class="grid content-start gap-1.5">
          <div class="flex min-h-6 items-center gap-2">
            <Label for="profile-name">Name</Label>
            <span class="text-xs text-muted-foreground">used by the lead</span>
          </div>
          {#if form.nameLocked}
            <div class="relative">
              <Lock
                class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="profile-name"
                class="pl-8"
                value={form.name}
                readonly
                disabled
              />
            </div>
            <p class="text-xs text-muted-foreground">
              Names can't change after creation. Use <i>Duplicate</i> to make a renamed
              copy.
            </p>
          {:else}
            <Input
              id="profile-name"
              class={clashName ? "border-warning" : undefined}
              value={form.name}
              oninput={(event) => {
                form.name = event.currentTarget.value;
                form.nameEdited = true;
              }}
              placeholder="reviewer"
              disabled={saving}
            />
            {#if clashName}
              <p class="text-xs text-warning" role="alert">
                A profile named <b>{clashName}</b> already exists here.
                {#if onEditExisting}
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0"
                    onclick={() =>
                      leave(() => onEditExisting?.(clashName ?? ""))}
                    >{clashBuiltIn
                      ? `Customize ${clashBuiltIn.label} instead`
                      : `Edit ${clashName}`}</Button
                  >, or pick another name.
                {:else}
                  Pick another name.
                {/if}
              </p>
            {:else if form.name && shown("name")}
              <p class="text-xs text-destructive" role="alert">
                {shown("name")}
              </p>
            {:else}
              <p class="text-xs text-muted-foreground">
                Lowercase letters, numbers and hyphens. Fixed once created.
              </p>
            {/if}
          {/if}
        </div>
      </div>
      <div class="grid gap-1.5">
        <div class="flex min-h-6 items-center gap-2">
          <Label for="profile-description">When should the lead use it?</Label>
          <span
            class={cn(
              "text-xs tabular-nums text-muted-foreground",
              form.description.trim().length >
                SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH && "text-destructive",
            )}
            >{form.description.trim().length} / {SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH}</span
          >
          {@render provenance("description", "Description")}
        </div>
        <Textarea
          id="profile-description"
          class={cn("min-h-16", dashed("description"))}
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
        {@render revertHint("description")}
        {#if shown("description")}
          {@render error("description")}
        {:else}
          <p class="text-xs text-muted-foreground">
            The lead reads this to pick a profile. Say what it is good at and
            what it returns.
          </p>
        {/if}
      </div>
    </section>

    <!-- Model -->
    <section class="grid gap-4" aria-labelledby="profile-model">
      <div class="grid gap-0.5">
        <h2 id="profile-model" class="text-sm font-semibold">Model</h2>
        <p class="text-xs text-muted-foreground">
          Fixed when a sub-agent is created. "Same as lead" copies the lead's
          current choice.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid content-start gap-1.5">
          <div class="flex min-h-6 items-center gap-2">
            <Label>Model</Label>
            {@render provenance("model", "Model")}
          </div>
          <ModelPicker
            label="Model"
            class={cn("w-full", dashed("model"))}
            {models}
            value={form.model}
            thinkingLevel={undefined}
            showReasoning={false}
            disabled={saving}
            inheritOption={{
              label: "Same as lead",
              description:
                "Sub-agents start on the model of the lead that created them.",
            }}
            inherit={form.modelLead}
            onInherit={() => {
              form.modelLead = true;
              pin("model");
            }}
            onChange={(next) => {
              form.model = next.model;
              form.modelLead = false;
              pin("model");
            }}
          />
          {@render revertHint("model")}
          {@render error("model")}
        </div>
        <div class="grid content-start gap-1.5">
          <div class="flex min-h-6 items-center gap-2">
            <Label>Thinking</Label>
            {@render provenance("thinking", "Thinking")}
          </div>
          <SelectField
            items={thinkingItems}
            value={form.thinking}
            ariaLabel="Thinking"
            class={dashed("thinking")}
            disabled={saving}
            onValueChange={(value) => {
              pin("thinking");
              form.thinking = value as SubagentProfileForm["thinking"];
            }}
          />
          {@render revertHint("thinking")}
        </div>
      </div>
      {#if thinkingIncompatible && !reset.includes("thinking") && !reset.includes("model")}
        <p class="text-xs text-destructive" role="alert">
          This model doesn't support {form.thinking} thinking. Choose a supported
          level; the profile stays blocked until they match. Your selection is kept.
        </p>
      {/if}
    </section>

    <!-- Permission, tools and skills -->
    <section class="grid gap-5" aria-labelledby="profile-capabilities">
      <div class="grid gap-0.5">
        <h2 id="profile-capabilities" class="text-sm font-semibold">
          What it may do
        </h2>
        <p class="text-xs text-muted-foreground">
          Sub-agents never ask you for approval, so only these two rule sets
          exist.
        </p>
      </div>
      <div class="grid gap-1.5">
        <div class="flex min-h-6 items-center gap-2">
          <Label id="profile-permission-label">Permission</Label>
          {@render provenance("permission", "Permission")}
        </div>
        <RadioGroup.Root
          value={form.permission}
          disabled={saving}
          aria-labelledby="profile-permission-label"
          class="grid gap-2 sm:grid-cols-2"
          onValueChange={(value) => {
            pin("permission");
            form.permission = value as SubagentProfileForm["permission"];
          }}
        >
          {#each permissionItems as item (item.value)}
            {@const Icon = item.icon}
            <Label
              class={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 font-normal transition-colors hover:bg-accent/50 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-selected",
                dashed("permission"),
              )}
            >
              <RadioGroup.Item value={item.value} class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="flex items-center gap-1.5 text-sm font-medium">
                  <Icon class="size-3.5" aria-hidden="true" />{item.label}
                </span>
                <span class="text-xs text-muted-foreground">{item.detail}</span>
              </span>
            </Label>
          {/each}
        </RadioGroup.Root>
        {@render revertHint("permission")}
      </div>

      <div class="grid gap-1.5">
        <div class="flex min-h-6 items-center gap-2">
          <Label id="profile-tools-label">Tools</Label>
          <span class="text-xs text-muted-foreground"
            >Differences from the lead's tools</span
          >
          {@render provenance("tools", "Tools")}
        </div>
        <ul
          class={cn(
            "m-0 list-none divide-y divide-border rounded-md border border-border p-0",
            dashed("tools"),
          )}
          aria-labelledby="profile-tools-label"
        >
          {#each toolGroups as group (group.key)}
            {@const delta = toolDelta(group.names)}
            {@const toolSource = group.names
              .map((name) => configuration?.origins.tools[name])
              .find((source) => source !== undefined)}
            <li
              class={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5",
                toolChanged(group.names) && "bg-muted",
              )}
            >
              <span class="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                <span class="truncate">{group.label}</span>
                {#if customizing && toolSource}
                  <span
                    title={`Set in ${profileLayerLabels[toolSource]}`}
                    class="inline-flex">{@render dot(toolSource)}</span
                  >
                {/if}
              </span>
              {#if delta === "custom"}
                <Badge
                  variant="outline"
                  title="Edit subagents.json to change these settings"
                  >Custom settings</Badge
                >
              {:else}
                <ToggleGroup.Root
                  type="single"
                  size="sm"
                  variant="chip"
                  spacing={1}
                  value={delta}
                  disabled={saving}
                  aria-label={`${group.label} for this profile`}
                  onValueChange={(value) => {
                    if (value) setToolDelta(group.names, value);
                  }}
                >
                  <ToggleGroup.Item value="same">Same as lead</ToggleGroup.Item>
                  <ToggleGroup.Item value="on">On</ToggleGroup.Item>
                  <ToggleGroup.Item value="off">Off</ToggleGroup.Item>
                </ToggleGroup.Root>
              {/if}
            </li>
          {/each}
        </ul>
        {@render revertHint("tools")}
        {@render error("tools")}
        <p class="text-xs text-muted-foreground">
          File, shell and search tools follow the permission above. Sub-agents
          can never ask questions, present plans or start their own sub-agents.
        </p>
      </div>

      <div class="grid gap-1.5">
        <div class="flex min-h-6 items-center gap-2">
          <Label id="profile-skills-label">Skills</Label>
          {@render provenance("skills", "Skills")}
        </div>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          value={form.skillsMode}
          disabled={saving}
          aria-labelledby="profile-skills-label"
          onValueChange={(value) => {
            if (!value) return;
            pin("skills");
            form.skillsMode = value as SubagentProfileForm["skillsMode"];
          }}
        >
          <ToggleGroup.Item value="inherit" class={dashed("skills")}
            >Same as lead</ToggleGroup.Item
          >
          <ToggleGroup.Item value="none" class={dashed("skills")}
            >None</ToggleGroup.Item
          >
          <ToggleGroup.Item value="custom" class={dashed("skills")}
            >Choose…</ToggleGroup.Item
          >
        </ToggleGroup.Root>
        {#if form.skillsMode === "custom"}
          {#if skillNames.length === 0}
            <p class="text-xs text-muted-foreground">
              No skills are available.
            </p>
          {:else}
            <ul
              class={cn(
                "m-0 list-none divide-y divide-border rounded-md border border-border p-0",
                dashed("skills"),
              )}
              aria-label="Skill changes"
            >
              {#each skillNames as name (name)}
                {@const skillSource = configuration?.origins.skills[name]}
                <li
                  class={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5",
                    skillChanged(name) && "bg-muted",
                  )}
                >
                  <span
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-sm"
                  >
                    <span class="truncate">{name}</span>
                    {#if customizing && skillSource}
                      <span
                        title={`Set in ${profileLayerLabels[skillSource]}`}
                        class="inline-flex">{@render dot(skillSource)}</span
                      >
                    {/if}
                  </span>
                  <ToggleGroup.Root
                    type="single"
                    size="sm"
                    variant="chip"
                    spacing={1}
                    value={skillDelta(name)}
                    disabled={saving}
                    aria-label={`${name} for this profile`}
                    onValueChange={(value) => {
                      if (value) setSkillDelta(name, value);
                    }}
                  >
                    <ToggleGroup.Item value="same"
                      >Same as lead</ToggleGroup.Item
                    >
                    <ToggleGroup.Item value="on">On</ToggleGroup.Item>
                    <ToggleGroup.Item value="off">Off</ToggleGroup.Item>
                  </ToggleGroup.Root>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
        {@render revertHint("skills")}
        {@render error("skills")}
      </div>
    </section>

    <!-- Instructions -->
    <section class="grid gap-3" aria-labelledby="profile-instructions">
      <div class="flex items-start gap-2">
        <div class="grid flex-1 gap-0.5">
          <h2 id="profile-instructions" class="text-sm font-semibold">
            Instructions
          </h2>
          <p class="text-xs text-muted-foreground">
            Added to the sub-agent's system prompt. The assignment from the lead
            comes on top.
          </p>
        </div>
        {@render provenance("instructions", "Instructions")}
      </div>
      {#if customizing && !isLocal("instructions")}
        <div
          class="max-h-64 overflow-auto rounded-md border border-dashed border-border p-3 text-sm whitespace-pre-wrap text-muted-foreground"
        >
          {form.instructions || "No instructions."}
        </div>
        <div class="flex items-start gap-3">
          <p class="flex-1 text-xs text-muted-foreground">
            Read-only until you choose <i>Customize</i>, which copies this text
            so you can edit it here. Later updates to the lower layer won't
            reach a customized copy, and you can revert at any time.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onclick={() => pin("instructions")}
          >
            <Pencil aria-hidden="true" />Customize
          </Button>
        </div>
      {:else}
        <Textarea
          id="profile-instructions-text"
          aria-labelledby="profile-instructions"
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
        <div class="flex items-start gap-3 text-xs text-muted-foreground">
          <span class="flex-1"
            >Markdown. Optional, but strongly recommended.</span
          >
          <span
            class={cn(
              "tabular-nums",
              instructionBytes > SUBAGENT_INSTRUCTIONS_MAX_BYTES &&
                "text-destructive",
            )}
            >{(instructionBytes / 1024).toFixed(1)} KB of {SUBAGENT_INSTRUCTIONS_MAX_BYTES /
              1024} KB</span
          >
        </div>
        {@render revertHint("instructions")}
        {@render error("instructions")}
      {/if}
    </section>

    <!-- Advanced -->
    <Collapsible.Root bind:open={advancedOpen}>
      <section class="grid gap-3" aria-labelledby="profile-advanced">
        <div class="flex items-center gap-2">
          <Collapsible.Trigger
            id="profile-advanced"
            class="group flex items-center gap-1 text-sm font-semibold"
          >
            <ChevronRight
              class="size-4 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden="true"
            />
            Advanced
          </Collapsible.Trigger>
          {#if !advancedOpen}
            <span class="text-xs text-muted-foreground"
              >Compaction: {form.compactionMode === "inherit"
                ? "Same as lead"
                : "Custom"}</span
            >
          {/if}
          {@render provenance("compaction", "Compaction")}
        </div>
        <Collapsible.Content class="grid gap-3 pl-5">
          <div class="grid gap-1.5">
            <Label>Compaction</Label>
            <SelectField
              items={compactionItems}
              value={form.compactionMode}
              ariaLabel="Compaction"
              class={dashed("compaction")}
              disabled={saving}
              onValueChange={(value) => {
                pin("compaction");
                form.compactionMode =
                  value as SubagentProfileForm["compactionMode"];
              }}
            />
          </div>
          {#if form.compactionMode === "profile"}
            <div class="flex items-center justify-between gap-3">
              <Label for="profile-compaction-auto">Auto-compact</Label>
              <Switch
                id="profile-compaction-auto"
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
              class={dashed("compaction")}
              disabled={saving}
              onValueChange={(value) => {
                pin("compaction");
                form.compactionProfile =
                  value as SubagentProfileForm["compactionProfile"];
              }}
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
                    class={dashed("compaction")}
                    value={String(form.triggerPercent)}
                    disabled={saving}
                    oninput={(event) => {
                      pin("compaction");
                      form.triggerPercent = Number(event.currentTarget.value);
                    }}
                  />
                </div>
                <div class="grid gap-1.5">
                  <Label for="profile-keep">Keep recent (%)</Label>
                  <Input
                    id="profile-keep"
                    type="number"
                    min={5}
                    max={40}
                    class={dashed("compaction")}
                    value={String(form.keepRecentPercent)}
                    disabled={saving}
                    oninput={(event) => {
                      pin("compaction");
                      form.keepRecentPercent = Number(
                        event.currentTarget.value,
                      );
                    }}
                  />
                </div>
              </div>
            {/if}
          {/if}
          {@render revertHint("compaction")}
          {@render error("compaction")}
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  </div>
{/snippet}
