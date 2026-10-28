<!-- The value editor of one profile change: the subject first, then its mode. -->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import LockOpen from "@lucide/svelte/icons/lock-open";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  utf8ByteLength,
  AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
} from "@nervekit/contracts/agent-profiles";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import { skillOverrideKind } from "$lib/domain/skills/skill-catalog";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import ToolConfigForm from "../tools/ToolConfigForm.svelte";
import {
  toolRow,
  toolRows,
  type ToolId,
  type ToolPayload,
} from "../tools/tool-settings";
import {
  modeHint,
  modesFor,
  unifyChangeMode,
  type ModelChangeValue,
  type SkillBuckets,
} from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

type Props = {
  compact?: boolean;
  draft: ChangeDraft;
  usableBy: ProfileUsableBy;
  context: ProfileEditContext;
  /** Tools already changed in this profile; hidden from a new-tool picker. */
  takenTools?: string[];
  /** The tool is fixed when editing. */
  fixedTool?: boolean;
  valid?: boolean;
};
let {
  compact = false,
  draft = $bindable(),
  usableBy,
  context,
  takenTools = [],
  fixedTool = false,
  valid = $bindable(true),
}: Props = $props();

const kind = $derived(
  draft.key.startsWith("tool:")
    ? "tool"
    : draft.key.startsWith("skill:")
      ? "skill"
      : draft.key === "skill-defaults"
        ? "skills"
        : draft.key,
);
const tool = $derived(
  draft.key.startsWith("tool:") ? (draft.key.slice(5) as ToolId) : undefined,
);
const modes = $derived(modesFor());
const leadMode = $derived(draft.mode === "settings");
const valueless = (mode: string) => mode === "settings";
const modeText = (mode: string) =>
  mode === "settings"
    ? "Use settings"
    : mode === "require"
      ? "Require"
      : "Recommend";

// Model: { model, thinking }.
const modelValue = $derived(draft.value as ModelChangeValue | undefined);
const modelMode = $derived(modelValue?.modelMode ?? draft.mode);
const thinkingMode = $derived(modelValue?.thinkingMode ?? draft.mode);
// Compaction.
const compaction = $derived(
  (draft.value ?? {
    auto: true,
    profile: "balanced",
    customTriggerPercent: 80,
  }) as { auto: boolean; profile: string; customTriggerPercent: number },
);
// Tool payload.
const payload = $derived((draft.value ?? {}) as ToolPayload);
let toolValid = $state(true);
// Skills.
const skillsValue = $derived(draft.value);
const skillsNone = $derived(skillsValue === "none");
const buckets = $derived(
  (skillsNone
    ? { file: {}, nerve: {}, agentBrowser: {} }
    : {
        file: {},
        nerve: {},
        agentBrowser: {},
        ...((skillsValue ?? {}) as Partial<SkillBuckets>),
      }) as SkillBuckets,
);
// Instructions.
const text = $derived(String(draft.value ?? ""));
const bytes = $derived(utf8ByteLength(text));

$effect(() => {
  const nextValid =
    kind === "instructions"
      ? bytes <= AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES
      : leadMode && kind !== "model"
        ? true
        : kind === "model"
          ? (valueless(modelMode) || Boolean(modelValue?.model)) &&
            (valueless(thinkingMode) || modelValue?.thinking !== undefined)
          : kind === "permission"
            ? Boolean(draft.value)
            : kind === "tool"
              ? Boolean(tool) && toolValid
              : true;
  if (valid !== nextValid) valid = nextValid;
});

function chooseTool(name: string): void {
  const id = name as ToolId;
  const seed = context.seedTool(id);
  draft = {
    ...draft,
    key: `tool:${id}`,
    value: { ...seed, ...(toolRow(id).always ? {} : { enabled: true }) },
  };
}

function skillState(
  kindName: "file" | "nerve" | "agentBrowser",
  name: string,
): string {
  const value = buckets[kindName][name];
  return value === undefined ? "inherit" : value ? "on" : "off";
}
function setSkill(
  source: "file" | "nerve" | "agentBrowser",
  name: string,
  state: string,
): void {
  const next: SkillBuckets = structuredClone(
    $state.snapshot(buckets),
  ) as SkillBuckets;
  if (state === "inherit") delete next[source][name];
  else next[source][name] = state === "on";
  draft = {
    ...draft,
    mode: draft.mode === "settings" ? "recommend" : draft.mode,
    value: next,
  };
}

const toolChoices = $derived(
  toolRows
    .filter(
      (row) =>
        !takenTools.includes(`tool:${row.id}`) &&
        (usableBy === "lead" ||
          (row.id !== "subagents" && row.id !== "plan_present")),
    )
    .map((row) => ({ value: row.id, label: row.label })),
);
</script>

<div class="grid gap-4">
  {#if !leadMode || kind === "model" || compact}
    {#if kind === "skill"}
      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        aria-label="Skill state"
        value={leadMode ? "settings" : draft.value ? "on" : "off"}
        onValueChange={(next) =>
          next &&
          (draft = {
            ...draft,
            mode:
              next === "settings"
                ? "settings"
                : draft.mode === "require"
                  ? "require"
                  : "recommend",
            value: next === "on",
          })}
        class="justify-start"
      >
        <ToggleGroup.Item value="settings">Default</ToggleGroup.Item
        ><ToggleGroup.Item value="on">On</ToggleGroup.Item><ToggleGroup.Item
          value="off">Off</ToggleGroup.Item
        >
      </ToggleGroup.Root>
    {:else if kind === "model"}
      <div class="grid gap-1.5">
        <Label>Model</Label>
        <ModelPicker
          label="Model"
          class="w-full"
          models={context.models}
          value={modelValue?.model}
          thinkingLevel={modelValue?.thinking}
          inheritOption={{
            label: "Default",
            description: "No model or reasoning contribution.",
          }}
          inherit={!modelValue?.model}
          onInherit={() =>
            (draft = {
              ...draft,
              value: { modelMode: "settings", thinkingMode: "settings" },
            })}
          onChange={(next) =>
            (draft = {
              ...draft,
              value: {
                ...modelValue,
                model: next.model,
                thinking: next.thinkingLevel,
                modelMode: modelMode === "settings" ? "recommend" : modelMode,
                thinkingMode:
                  thinkingMode === "settings" ? "recommend" : thinkingMode,
              },
            })}
        />
        {#if !compact}
          {#each [{ key: "modelMode", label: "Model", value: modelMode }, { key: "thinkingMode", label: "Reasoning", value: thinkingMode }] as field (field.key)}
            <div class="grid gap-1.5 pt-2">
              <span class="text-xs text-muted-foreground"
                >{field.label} mode</span
              >
              <ToggleGroup.Root
                type="single"
                variant="chip"
                size="sm"
                aria-label={`${field.label} mode`}
                value={field.value}
                class="flex-wrap justify-start"
                onValueChange={(next) =>
                  next &&
                  (draft = {
                    ...draft,
                    value: { ...modelValue, [field.key]: next },
                  })}
              >
                {#each modes as mode (mode)}
                  <ToggleGroup.Item value={mode}
                    >{modeText(mode)}</ToggleGroup.Item
                  >
                {/each}
              </ToggleGroup.Root>
              <p class="text-xs text-muted-foreground">
                {modeHint(field.value)}
              </p>
            </div>
          {/each}
        {:else if modelValue?.model || modelValue?.thinking}<IconAction
            icon={draft.mode === "require" ? Lock : LockOpen}
            label="Require model and reasoning"
            onclick={() =>
              (draft = unifyChangeMode(
                draft,
                draft.mode === "require" ? "recommend" : "require",
              ))}
          />{/if}
      </div>
    {:else if kind === "permission"}
      <div class="grid gap-1.5">
        <Label>Permission rule set</Label>
        {#if compact}
          <ToggleGroup.Root
            type="single"
            variant="outline"
            size="sm"
            aria-label="Permission rule set"
            value={leadMode ? "settings" : String(draft.value ?? "")}
            onValueChange={(next) =>
              next &&
              (draft = {
                ...draft,
                mode:
                  next === "settings"
                    ? "settings"
                    : draft.mode === "require"
                      ? "require"
                      : "recommend",
                value: next === "settings" ? undefined : next,
              })}
            class="flex-wrap justify-start"
          >
            <ToggleGroup.Item value="settings">Default</ToggleGroup.Item>
            {#each context.permissionOptions.filter((option) => usableBy === "lead" || option.value !== "planning") as option (option.value)}<ToggleGroup.Item
                value={option.value}>{option.label}</ToggleGroup.Item
              >{/each}
          </ToggleGroup.Root>
        {:else}
          <SelectField
            items={context.permissionOptions.filter(
              (option) => usableBy === "lead" || option.value !== "planning",
            )}
            value={String(draft.value ?? "")}
            placeholder="Choose a rule set"
            ariaLabel="Permission rule set"
            onValueChange={(next) => (draft = { ...draft, value: next })}
          />
        {/if}
      </div>
    {:else if kind === "compaction"}
      {#if compact}
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          aria-label="Compaction"
          value={leadMode
            ? "settings"
            : !compaction.auto
              ? "off"
              : compaction.profile}
          onValueChange={(next) =>
            next &&
            (draft = {
              ...draft,
              mode:
                next === "settings"
                  ? "settings"
                  : draft.mode === "require"
                    ? "require"
                    : "recommend",
              value: {
                ...compaction,
                auto: next !== "off",
                profile:
                  next === "off" || next === "settings"
                    ? compaction.profile
                    : next,
              },
            })}
          class="flex-wrap justify-start"
        >
          <ToggleGroup.Item value="settings">Default</ToggleGroup.Item
          ><ToggleGroup.Item value="off">Off</ToggleGroup.Item>
          {#each compactionProfileItems as option (option.value)}<ToggleGroup.Item
              value={option.value}>{option.label}</ToggleGroup.Item
            >{/each}
        </ToggleGroup.Root>
      {:else}
        <div class="flex items-center justify-between gap-4">
          <Label for="change-compaction-auto">Auto-compact</Label>
          <Switch
            id="change-compaction-auto"
            checked={compaction.auto}
            aria-label="Auto-compact"
            onCheckedChange={(auto) =>
              (draft = { ...draft, value: { ...compaction, auto } })}
          />
        </div>
      {/if}
      {#if compaction.auto && (!compact || !leadMode)}
        {#if !compact}<div class="grid gap-1.5">
            <Label>Compaction strategy</Label>
            <SelectField
              items={compactionProfileItems.map((item) => ({
                value: item.value,
                label: item.label,
                detail: item.detail,
              }))}
              value={compaction.profile}
              ariaLabel="Compaction strategy"
              onValueChange={(profile) =>
                (draft = { ...draft, value: { ...compaction, profile } })}
            />
          </div>
        {/if}
        {#if compaction.profile === "custom"}
          <div class="grid gap-1.5">
            <Label for="change-compaction-percent">Compact at</Label>
            <div class="flex items-center gap-2">
              <Input
                id="change-compaction-percent"
                type="number"
                min={60}
                max={90}
                value={String(compaction.customTriggerPercent)}
                oninput={(event) =>
                  (draft = {
                    ...draft,
                    value: {
                      ...compaction,
                      customTriggerPercent: Number(event.currentTarget.value),
                    },
                  })}
              />
              <span class="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        {/if}
      {/if}
    {:else if kind === "tool"}
      {#if fixedTool && tool && !compact}
        <p class="text-sm text-foreground">{toolRow(tool).label}</p>
      {:else if !fixedTool}
        <div class="grid gap-1.5">
          <Label>Tool</Label>
          <SelectField
            items={toolChoices}
            value={tool ?? ""}
            placeholder="Choose a tool"
            ariaLabel="Tool"
            onValueChange={chooseTool}
          />
        </div>
      {/if}
      {#if tool}
        {#if compact && toolRow(tool).always}
          <ToggleGroup.Root
            type="single"
            variant="outline"
            size="sm"
            aria-label={`${toolRow(tool).label} configuration`}
            value={leadMode ? "settings" : "configure"}
            onValueChange={(next) =>
              next &&
              (draft = {
                ...draft,
                mode: next === "settings" ? "settings" : "recommend",
              })}
            class="justify-start"
            ><ToggleGroup.Item value="settings">Default</ToggleGroup.Item
            ><ToggleGroup.Item value="configure">Configure</ToggleGroup.Item
            ></ToggleGroup.Root
          >
        {/if}
        {#if compact && !toolRow(tool).always}
          <ToggleGroup.Root
            type="single"
            variant="outline"
            size="sm"
            aria-label={`${toolRow(tool).label} state`}
            value={leadMode ? "settings" : payload.enabled ? "on" : "off"}
            onValueChange={(next) =>
              next &&
              (draft = {
                ...draft,
                mode:
                  next === "settings"
                    ? "settings"
                    : draft.mode === "require"
                      ? "require"
                      : "recommend",
                value: { ...payload, enabled: next === "on" },
              })}
            class="justify-start"
          >
            <ToggleGroup.Item value="settings">Default</ToggleGroup.Item
            ><ToggleGroup.Item value="on">On</ToggleGroup.Item><ToggleGroup.Item
              value="off">Off</ToggleGroup.Item
            >
          </ToggleGroup.Root>
        {:else if !toolRow(tool).always}
          <div class="flex items-center justify-between gap-4">
            <Label for="change-tool-enabled"
              >Turn {payload.enabled ? "on" : "off"}</Label
            >
            <Switch
              id="change-tool-enabled"
              checked={payload.enabled === true}
              aria-label="Enable tool"
              onCheckedChange={(enabled) =>
                (draft = { ...draft, value: { ...payload, enabled } })}
            />
          </div>
        {/if}
        {#if toolRow(tool).configurable && !leadMode && (payload.enabled || toolRow(tool).always)}
          <ToolConfigForm
            name={tool}
            bind:payload={
              () => payload, (value) => (draft = { ...draft, value })
            }
            bind:valid={toolValid}
            models={context.models}
            accounts={context.accountsFor(tool)}
            noAccountLabel="Use the account from settings"
            leadProfiles={context.leadProfiles}
          />
        {/if}
      {/if}
    {:else if kind === "skills"}
      {#each ["file", "nerve", "agentBrowser"] as source (source)}
        {@const kind = source as "file" | "nerve" | "agentBrowser"}
        <div class="grid gap-1.5">
          <Label
            >New {source === "file"
              ? "file"
              : source === "nerve"
                ? "Nerve"
                : "Agent Browser"} skills</Label
          >
          <SelectField
            ariaLabel={`Default for ${source} skills`}
            items={[
              { value: "inherit", label: "Use settings" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
            value={buckets.defaults?.[kind] === undefined
              ? "inherit"
              : buckets.defaults[kind]
                ? "on"
                : "off"}
            onValueChange={(value) => {
              const defaults = { ...buckets.defaults };
              if (value === "inherit") delete defaults[kind];
              else defaults[kind] = value === "on";
              draft = {
                ...draft,
                mode: draft.mode === "settings" ? "recommend" : draft.mode,
                value: { ...buckets, defaults },
              };
            }}
          />
        </div>
      {/each}
      {#if draft.key !== "skill-defaults"}
        <ToggleGroup.Root
          type="single"
          variant="chip"
          size="sm"
          aria-label="Skills"
          value={skillsNone ? "none" : "choose"}
          onValueChange={(next) =>
            next &&
            (draft = {
              ...draft,
              mode: draft.mode === "settings" ? "recommend" : draft.mode,
              value: next === "none" ? "none" : buckets,
            })}
        >
          <ToggleGroup.Item value="none">None</ToggleGroup.Item>
          <ToggleGroup.Item value="choose">Choose skills</ToggleGroup.Item>
        </ToggleGroup.Root>
        {#if !skillsNone}
          <div class="grid max-h-64 gap-1 overflow-auto">
            {#each context.skills as skill (skill.filePath)}
              {@const source = skillOverrideKind(skill.source)}
              <div class="flex items-center justify-between gap-3">
                <span class="truncate text-sm text-foreground"
                  >{skill.name}</span
                >
                <ToggleGroup.Root
                  type="single"
                  variant="chip"
                  size="sm"
                  aria-label={`${skill.name} in this profile`}
                  value={skillState(source, skill.name)}
                  onValueChange={(next) =>
                    next && setSkill(source, skill.name, next)}
                >
                  <ToggleGroup.Item value="inherit">Default</ToggleGroup.Item>
                  <ToggleGroup.Item value="on">On</ToggleGroup.Item>
                  <ToggleGroup.Item value="off">Off</ToggleGroup.Item>
                </ToggleGroup.Root>
              </div>
            {:else}
              <p class="text-xs text-muted-foreground">
                No skills are installed.
              </p>
            {/each}
          </div>
        {/if}
      {/if}
    {:else if kind === "instructions"}
      <div class="grid gap-1.5">
        <Label for="change-instructions">Instructions</Label>
        <Textarea
          id="change-instructions"
          rows={6}
          value={text}
          placeholder="Added to the system prompt"
          oninput={(event) =>
            (draft = { ...draft, value: event.currentTarget.value })}
        />
        <p
          class={bytes > AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"}
        >
          {bytes} / {AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES} bytes. Added to the system
          prompt when the profile is applied.
        </p>
      </div>
    {/if}
  {/if}

  {#if kind !== "instructions" && kind !== "model"}
    {#if compact}
      {#if !leadMode}<IconAction
          icon={draft.mode === "require" ? Lock : LockOpen}
          label={draft.mode === "require"
            ? "Require: click to recommend"
            : "Recommend: click to require"}
          onclick={() =>
            (draft = {
              ...draft,
              mode: draft.mode === "require" ? "recommend" : "require",
            })}
        />{/if}
    {:else}
      <div class="grid gap-1.5">
        <ToggleGroup.Root
          type="single"
          variant="chip"
          size="sm"
          aria-label="Mode"
          value={draft.mode}
          onValueChange={(next) =>
            next && (draft = { ...draft, mode: next as typeof draft.mode })}
          class="flex-wrap"
        >
          {#each modes as mode (mode)}
            <ToggleGroup.Item value={mode}>{modeText(mode)}</ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        <p class="text-xs text-muted-foreground">{modeHint(draft.mode)}</p>
      </div>
    {/if}
  {/if}
</div>
