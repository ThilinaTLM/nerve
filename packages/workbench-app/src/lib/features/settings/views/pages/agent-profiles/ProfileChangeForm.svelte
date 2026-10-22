<!-- The value editor of one profile change: the subject first, then its mode. -->
<script lang="ts">
import { thinkingLevels, type ThinkingLevel } from "@nervekit/contracts/models";
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
import type { AgentProfileUsableBy } from "@nervekit/contracts/agent-profiles";
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
  type ModelChangeValue,
  type SkillBuckets,
} from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

type Props = {
  draft: ChangeDraft;
  usableBy: AgentProfileUsableBy;
  context: ProfileEditContext;
  /** Tools already changed in this profile; hidden from a new-tool picker. */
  takenTools?: string[];
  /** The tool is fixed when editing. */
  fixedTool?: boolean;
  valid?: boolean;
};
let {
  draft = $bindable(),
  usableBy,
  context,
  takenTools = [],
  fixedTool = false,
  valid = $bindable(true),
}: Props = $props();

const kind = $derived(draft.key.startsWith("tool:") ? "tool" : draft.key);
const tool = $derived(
  draft.key.startsWith("tool:") ? (draft.key.slice(5) as ToolId) : undefined,
);
const modes = $derived(modesFor(usableBy));
const leadMode = $derived(draft.mode === "lead");

// Model: { model, thinking }.
const modelValue = $derived(draft.value as ModelChangeValue | undefined);
const reasoningItems = [
  { value: "", label: "Use settings" },
  ...thinkingLevels.map((level) => ({
    value: level,
    label: level.charAt(0).toUpperCase() + level.slice(1),
  })),
];
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
    : (skillsValue ?? {
        file: {},
        nerve: {},
        agentBrowser: {},
      })) as SkillBuckets,
);
// Instructions.
const text = $derived(String(draft.value ?? ""));
const bytes = $derived(utf8ByteLength(text));

$effect(() => {
  const nextValid =
    kind === "instructions"
      ? text.trim().length > 0 && bytes <= AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES
      : leadMode
        ? true
        : kind === "model"
          ? Boolean(modelValue?.model || modelValue?.thinking)
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

function skillState(kindName: keyof SkillBuckets, name: string): string {
  const value = buckets[kindName][name];
  return value === undefined ? "inherit" : value ? "on" : "off";
}
function setSkill(
  source: keyof SkillBuckets,
  name: string,
  state: string,
): void {
  const next: SkillBuckets = structuredClone(
    $state.snapshot(buckets),
  ) as SkillBuckets;
  if (state === "inherit") delete next[source][name];
  else next[source][name] = state === "on";
  draft = { ...draft, value: next };
}

const toolChoices = $derived(
  toolRows
    .filter((row) => !takenTools.includes(`tool:${row.id}`))
    .map((row) => ({ value: row.id, label: row.label })),
);
</script>

<div class="grid gap-4">
  {#if !leadMode}
    {#if kind === "model"}
      <div class="grid gap-1.5">
        <Label>Model</Label>
        <ModelPicker
          label="Model"
          class="w-full"
          models={context.models}
          value={modelValue?.model}
          thinkingLevel={modelValue?.thinking}
          inheritOption={{
            label: "Use settings",
            description: "Leave the model as configured in settings.",
          }}
          inherit={!modelValue?.model}
          onInherit={() =>
            (draft = { ...draft, value: { thinking: modelValue?.thinking } })}
          onChange={(next) =>
            (draft = {
              ...draft,
              value: { model: next.model, thinking: next.thinkingLevel },
            })}
        />
        {#if !modelValue?.model}
          <SelectField
            items={reasoningItems}
            value={modelValue?.thinking ?? ""}
            ariaLabel="Reasoning level"
            onValueChange={(next) =>
              (draft = {
                ...draft,
                value: {
                  thinking: (next || undefined) as ThinkingLevel | undefined,
                },
              })}
          />
        {/if}
      </div>
    {:else if kind === "permission"}
      <div class="grid gap-1.5">
        <Label>Permission rule set</Label>
        <SelectField
          items={context.permissionOptions}
          value={String(draft.value ?? "")}
          placeholder="Choose a rule set"
          ariaLabel="Permission rule set"
          onValueChange={(next) => (draft = { ...draft, value: next })}
        />
      </div>
    {:else if kind === "compaction"}
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
      {#if compaction.auto}
        <div class="grid gap-1.5">
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
      {#if fixedTool && tool}
        <p class="text-sm text-foreground">{toolRow(tool).label}</p>
      {:else}
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
        {#if !toolRow(tool).always}
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
        {#if toolRow(tool).configurable && (payload.enabled || toolRow(tool).always)}
          <ToolConfigForm
            name={tool}
            {payload}
            bind:valid={toolValid}
            models={context.models}
            accounts={context.accountsFor(tool)}
            noAccountLabel="Use the account from settings"
            leadProfiles={context.leadProfiles}
          />
        {/if}
      {/if}
    {:else if kind === "skills"}
      <ToggleGroup.Root
        type="single"
        variant="chip"
        size="sm"
        aria-label="Skills"
        value={skillsNone ? "none" : "choose"}
        onValueChange={(next) =>
          next &&
          (draft = { ...draft, value: next === "none" ? "none" : buckets })}
      >
        <ToggleGroup.Item value="none">None</ToggleGroup.Item>
        <ToggleGroup.Item value="choose">Choose skills</ToggleGroup.Item>
      </ToggleGroup.Root>
      {#if !skillsNone}
        <div class="grid max-h-64 gap-1 overflow-auto">
          {#each context.skills as skill (skill.filePath)}
            {@const source = skillOverrideKind(skill.source)}
            <div class="flex items-center justify-between gap-3">
              <span class="truncate text-sm text-foreground">{skill.name}</span>
              <ToggleGroup.Root
                type="single"
                variant="chip"
                size="sm"
                aria-label={`${skill.name} in this profile`}
                value={skillState(source, skill.name)}
                onValueChange={(next) =>
                  next && setSkill(source, skill.name, next)}
              >
                <ToggleGroup.Item value="inherit">Use settings</ToggleGroup.Item
                >
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

  {#if kind !== "instructions"}
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
          <ToggleGroup.Item value={mode}
            >{mode === "lead"
              ? "Same as lead agent"
              : mode === "lock"
                ? "Lock"
                : "Set"}</ToggleGroup.Item
          >
        {/each}
      </ToggleGroup.Root>
      <p class="text-xs text-muted-foreground">{modeHint(draft.mode)}</p>
    </div>
  {/if}
</div>
