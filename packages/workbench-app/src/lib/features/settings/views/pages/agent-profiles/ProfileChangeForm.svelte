<!-- The value editor of one profile change: the subject first, then its mode. -->
<script lang="ts">
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
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import ToolConfigForm from "../tools/ToolConfigForm.svelte";
import {
  toolRow,
  toolRows,
  type ToolId,
  type ToolPayload,
} from "../tools/tool-settings";
import { modeHint, modesFor, type ModelChangeValue } from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

type Props = {
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
  {#if !leadMode || kind === "model"}
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

        {#each [{ key: "modelMode", label: "Model", value: modelMode }, { key: "thinkingMode", label: "Reasoning", value: thinkingMode }] as field (field.key)}
          <div class="grid gap-1.5 pt-2">
            <span class="text-xs text-muted-foreground">{field.label} mode</span
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
      </div>
    {:else if kind === "permission"}
      <div class="grid gap-1.5">
        <Label>Permission rule set</Label>

        <SelectField
          items={context.permissionOptions.filter(
            (option) => usableBy === "lead" || option.value !== "planning",
          )}
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
</div>
