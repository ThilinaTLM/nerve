<script lang="ts">
import { untrack } from "svelte";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import { ModelPickerPanel } from "$lib/presentation/model-picker";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import {
  PopoverBody,
  PopoverHeader,
  PopoverFooter,
  PopoverRow,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import ProfileToolConfigForm from "./ProfileToolConfigForm.svelte";
import { unifyChangeMode, type ModelChangeValue } from "./profile-changes";
import { toolRow, type ToolId, type ToolPayload } from "../tools/tool-settings";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";
let {
  change,
  context,
  usableBy,
  onSave,
  onRemove,
  title,
  onBack,
}: {
  change: ChangeDraft;
  context: ProfileEditContext;
  usableBy: ProfileUsableBy;
  title: string;
  onSave: (change: ChangeDraft) => Promise<void>;
  onRemove?: () => void;
  onBack?: () => void;
} = $props();
let draft = $state<ChangeDraft>(
  untrack(() => structuredClone($state.snapshot(change))),
);
let error = $state<string>();
let saving = $state(false);
let configure = $state(false);
let valid = $state(true);
let configured = $state<ChangeDraft>(
  untrack(() => structuredClone($state.snapshot(change))),
);
const model = $derived(draft.value as ModelChangeValue | undefined);
const tool = $derived(
  draft.key.startsWith("tool:") ? (draft.key.slice(5) as ToolId) : undefined,
);
const payload = $derived((draft.value ?? {}) as ToolPayload);
const compaction = $derived(
  (draft.value ?? {
    auto: true,
    profile: "balanced",
    customTriggerPercent: 80,
  }) as { auto: boolean; profile: string; customTriggerPercent: number },
);
async function save(next: ChangeDraft) {
  if (saving) return;
  saving = true;
  error = undefined;
  try {
    await onSave(next);
    draft = structuredClone(next);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
let instructions = $state(untrack(() => String(change.value ?? "")));
let instructionSave: Promise<void> | undefined;
async function saveInstructions() {
  if (instructionSave) return instructionSave;
  if (instructions !== draft.value) {
    instructionSave = save({ ...draft, value: instructions });
    await instructionSave;
    instructionSave = undefined;
  }
}
export async function flush(): Promise<boolean> {
  if (draft.key === "instructions") await saveInstructions();
  return !error;
}
</script>
<PopoverHeader {title}>
  {#snippet actions()}
    {#if onBack}<Button variant="ghost" size="sm" onclick={onBack}>Back</Button
      >{/if}
    {#if onRemove}<Button
        variant="ghost"
        size="sm"
        disabled={saving}
        onclick={async () => {
          await save(unifyChangeMode(draft, "settings"));
          if (!error) onRemove?.();
        }}>Remove</Button
      >{/if}
  {/snippet}
</PopoverHeader>
{#if error}<p role="alert" class="px-3 py-2 text-xs text-destructive">
    {error}
  </p>{/if}
{#if draft.key === "model"}
  <ModelPickerPanel
    models={context.models}
    value={model?.model}
    thinkingLevel={model?.thinking}
    onChange={(next) =>
      save(
        unifyChangeMode(
          {
            key: "model",
            value: { model: next.model, thinking: next.thinkingLevel },
          },
          draft.mode === "require" ? "require" : "recommend",
        ),
      )}
  />
{:else}
  <PopoverBody>
    <PopoverSection>
      {#if draft.key === "permission"}
        {#each context.permissionOptions.filter((option) => usableBy === "lead" || option.value !== "planning") as option (option.value)}
          <PopoverRow
            label={option.label}
            detail={option.detail}
            selected={draft.value === option.value}
            onclick={() => save({ ...draft, value: option.value })}
            >{#snippet trailing()}{#if option.value === context.defaultPermission}<span
                  class="text-muted-foreground">Default</span
                >{/if}{/snippet}</PopoverRow
          >
        {/each}
      {:else if draft.key === "compaction"}
        <PopoverRow
          label="Off"
          detail="Do not compact automatically"
          selected={!compaction.auto}
          onclick={() =>
            save({ ...draft, value: { ...compaction, auto: false } })}
        />
        {#each compactionProfileItems as option (option.value)}
          <PopoverRow
            label={option.label}
            detail={option.detail}
            selected={compaction.auto && compaction.profile === option.value}
            onclick={() =>
              save({
                ...draft,
                value: { ...compaction, auto: true, profile: option.value },
              })}
          />
        {/each}
        {#if compaction.auto && compaction.profile === "custom"}
          <div class="flex items-center gap-2 p-2">
            <Input
              aria-label="Compact at percent"
              type="number"
              min={60}
              max={90}
              value={String(compaction.customTriggerPercent)}
              onchange={(e) =>
                save({
                  ...draft,
                  value: {
                    ...compaction,
                    customTriggerPercent: Number(e.currentTarget.value),
                  },
                })}
            /><span class="text-xs text-muted-foreground">%</span>
          </div>
        {/if}
      {:else if draft.key === "instructions"}
        <Textarea
          aria-label="Instructions"
          rows={8}
          bind:value={instructions}
          onblur={saveInstructions}
          placeholder="What should this profile do differently?"
        />
      {:else if draft.key.startsWith("skill:") || tool}
        {#if !tool || !toolRow(tool).always}
          {#each [true, false] as enabled (enabled)}
            <PopoverRow
              label={enabled ? "On" : "Off"}
              selected={tool
                ? payload.enabled === enabled
                : draft.value === enabled}
              onclick={() =>
                save({
                  ...draft,
                  value: tool ? { ...payload, enabled } : enabled,
                })}
            >
              {#snippet trailing()}{#if tool && (context.seedTool(tool).enabled ?? true) === enabled}<span
                    class="text-muted-foreground">Default</span
                  >{/if}{/snippet}
            </PopoverRow>
          {/each}
        {/if}
        {#if tool === "plan_present" && payload.enabled}
          <PopoverSection label="After approval, switch to" separated>
            <ToggleGroup.Root
              type="single"
              variant="chip"
              size="sm"
              aria-label="After approval"
              value={String(payload.settings?.approvalProfile ?? "")}
              onValueChange={(value) =>
                value &&
                save({
                  ...draft,
                  value: {
                    ...payload,
                    settings: { ...payload.settings, approvalProfile: value },
                  },
                })}
              class="flex-wrap justify-start"
            >
              {#each context.leadProfiles as profile (profile.name)}<ToggleGroup.Item
                  value={profile.name}>{profile.label}</ToggleGroup.Item
                >{/each}
            </ToggleGroup.Root>
          </PopoverSection>
        {/if}
        {#if tool && toolRow(tool).configurable}
          <PopoverRow
            label="Configure"
            onclick={() => {
              configured = structuredClone($state.snapshot(draft));
              configure = true;
            }}
          />
        {/if}
      {/if}
    </PopoverSection>
  </PopoverBody>
{/if}
{#if draft.key === "instructions"}<PopoverFooter
    ><span class="text-muted-foreground">Added to the system prompt.</span
    ></PopoverFooter
  >{/if}
<DialogShell
  bind:open={configure}
  title={`Configure ${tool ? toolRow(tool).label : title}`}
  size="wide"
>
  <ProfileToolConfigForm bind:draft={configured} {context} bind:valid />
  {#snippet footer()}<Button variant="ghost" onclick={() => (configure = false)}
      >Cancel</Button
    ><Button
      disabled={!valid || saving}
      onclick={async () => {
        await save(configured);
        if (!error) configure = false;
      }}>Save</Button
    >{/snippet}
</DialogShell>
