<!--
  Profile card header with in-place editing. Existing profiles edit the label
  and when-to-use on click (Enter or blur saves, Escape cancels); the ID is
  fixed. A new profile (or duplicate) shows all three fields with Create.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";
import {
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  AGENT_PROFILE_NAME_MAX_LENGTH,
  AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH,
  agentProfileNameSchema,
} from "@nervekit/contracts/agent-profiles";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { normalizeProfileName } from "./profile-changes";

export type ProfileHeadPatch = Pick<
  ProfileDefinition,
  "name" | "label" | "whenToUse"
>;

let {
  definition,
  isNew = false,
  disabled = false,
  editHint,
  badges,
  onSave,
  onCancel,
}: {
  definition: ProfileHeadPatch;
  isNew?: boolean;
  disabled?: boolean;
  /** Tooltip on editable text, e.g. that editing saves a local copy. */
  editHint?: string;
  badges?: Snippet;
  onSave: (patch: ProfileHeadPatch) => Promise<void>;
  onCancel?: () => void;
} = $props();

// svelte-ignore state_referenced_locally
let label = $state(definition.label ?? "");
// svelte-ignore state_referenced_locally
let name = $state(definition.name);
// svelte-ignore state_referenced_locally
let whenToUse = $state(definition.whenToUse);
let idEdited = $state(false);
let editing = $state<"label" | "whenToUse">();
let saving = $state(false);
let error = $state<string>();
let labelInput = $state<HTMLInputElement | null>(null);
let whenInput = $state<HTMLTextAreaElement | null>(null);

$effect(() => {
  (editing === "whenToUse" ? whenInput : labelInput)?.focus();
});

const valid = $derived(
  agentProfileNameSchema.safeParse(name).success && !!whenToUse.trim(),
);

function patch(): ProfileHeadPatch {
  return {
    name,
    label: label.trim() || undefined,
    whenToUse: whenToUse.trim(),
  };
}

function startEdit(field: "label" | "whenToUse") {
  if (disabled) return;
  label = definition.label ?? "";
  whenToUse = definition.whenToUse;
  error = undefined;
  editing = field;
}

async function save() {
  if (saving || !valid) return;
  saving = true;
  error = undefined;
  try {
    await onSave(patch());
    editing = undefined;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}

async function commit() {
  if (!editing || saving) return;
  const next = patch();
  if (
    next.label === definition.label &&
    next.whenToUse === definition.whenToUse
  ) {
    editing = undefined;
    return;
  }
  if (!next.whenToUse) {
    editing = undefined;
    return;
  }
  await save();
}

function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (isNew) onCancel?.();
    else editing = undefined;
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (isNew) void save();
    else void commit();
  }
}

const editable =
  "-mx-1 cursor-text rounded-sm px-1 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent";
</script>

{#if isNew}
  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <Input
        bind:ref={labelInput}
        ariaLabel="Label"
        class="max-w-56"
        value={label}
        maxlength={AGENT_PROFILE_LABEL_MAX_LENGTH}
        placeholder="Label, e.g. UI Developer"
        onkeydown={keydown}
        oninput={(event) => {
          label = event.currentTarget.value;
          if (!idEdited) name = normalizeProfileName(label);
        }}
      />
      <Input
        ariaLabel="ID"
        class="max-w-44 font-mono"
        value={name}
        maxlength={AGENT_PROFILE_NAME_MAX_LENGTH}
        placeholder="id"
        title="Agents use this ID to refer to the profile. It can't be changed later."
        onkeydown={keydown}
        oninput={(event) => {
          idEdited = true;
          name = normalizeProfileName(event.currentTarget.value);
          event.currentTarget.value = name;
        }}
      />
    </div>
    <Textarea
      aria-label="When to use"
      rows={2}
      bind:value={whenToUse}
      maxlength={AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH}
      placeholder="Use when… (the agent reads this to decide when to use the profile)"
      onkeydown={keydown}
    />
    {#if error}<p role="alert" class="text-ui text-destructive">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={saving} onclick={onCancel}
        >Cancel</Button
      >
      <Button size="sm" disabled={saving || !valid} onclick={save}
        >{saving ? "Creating…" : "Create profile"}</Button
      >
    </div>
  </div>
{:else}
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    {#if editing === "label"}
      <Input
        bind:ref={labelInput}
        ariaLabel="Label"
        class="max-w-56"
        bind:value={label}
        maxlength={AGENT_PROFILE_LABEL_MAX_LENGTH}
        placeholder={definition.name}
        disabled={saving}
        onkeydown={keydown}
        onblur={commit}
      />
    {:else}
      <button
        type="button"
        class={`${editable} text-ui font-medium text-foreground`}
        title={editHint ?? "Rename"}
        {disabled}
        onclick={() => startEdit("label")}
      >
        {definition.label ?? definition.name}
      </button>
    {/if}
    <span
      class="font-mono text-ui text-muted-foreground"
      title="Agents use this ID to refer to the profile. Duplicate to use a different ID."
      >{definition.name}</span
    >
    {#if badges}{@render badges()}{/if}
  </div>
  {#if editing === "whenToUse"}
    <Textarea
      bind:ref={whenInput}
      aria-label="When to use"
      rows={2}
      bind:value={whenToUse}
      maxlength={AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH}
      placeholder="Use when…"
      disabled={saving}
      onkeydown={keydown}
      onblur={commit}
    />
  {:else}
    <button
      type="button"
      class={`${editable} line-clamp-2 text-ui text-muted-foreground`}
      title={editHint ?? "Edit when to use"}
      {disabled}
      onclick={() => startEdit("whenToUse")}
    >
      {definition.whenToUse}
    </button>
  {/if}
{/if}
