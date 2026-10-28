<script lang="ts">
import { untrack } from "svelte";
import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";
import {
  AGENT_PROFILE_NAME_MAX_LENGTH,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  agentProfileNameSchema,
  AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH,
} from "@nervekit/contracts/agent-profiles";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { normalizeProfileName } from "./profile-changes";

let {
  open = $bindable(false),
  definition,
  isNew = false,
  onSave,
}: {
  open?: boolean;
  definition: ProfileDefinition;
  isNew?: boolean;
  onSave: (definition: ProfileDefinition) => Promise<void>;
} = $props();
let draft = $state(untrack(() => structuredClone($state.snapshot(definition))));
let error = $state<string>();
let saving = $state(false);
let idEdited = $state(false);
$effect(() => {
  const value = definition;
  untrack(() => {
    draft = structuredClone($state.snapshot(value));
    error = undefined;
    idEdited = false;
  });
});
async function save() {
  saving = true;
  error = undefined;
  try {
    await onSave({
      ...$state.snapshot(draft),
      label: draft.label?.trim() || undefined,
      whenToUse: draft.whenToUse.trim(),
      name: draft.name,
    });
    open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
</script>
<DialogShell
  bind:open
  size="sm"
  title={isNew ? "New profile" : `Edit ${draft.label ?? draft.name}`}
>
  <div class="grid gap-4">
    {#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
    <div class="grid gap-1.5">
      <Label for="profile-label">Label</Label>
      <Input
        id="profile-label"
        value={draft.label ?? ""}
        maxlength={AGENT_PROFILE_LABEL_MAX_LENGTH}
        placeholder="UI Developer"
        oninput={(event) => {
          draft.label = event.currentTarget.value;
          if (isNew && !idEdited)
            draft.name = normalizeProfileName(draft.label);
        }}
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="profile-name">ID</Label>
      <Input
        id="profile-name"
        value={draft.name}
        oninput={(event) => {
          idEdited = true;
          draft.name = normalizeProfileName(event.currentTarget.value);
          event.currentTarget.value = draft.name;
        }}
        readonly={!isNew}
        aria-describedby="profile-name-hint"
        maxlength={AGENT_PROFILE_NAME_MAX_LENGTH}
      />
      <p id="profile-name-hint" class="text-xs text-muted-foreground">
        Agents use this ID to refer to the profile.{#if !isNew}
          Duplicate to use a different ID.{/if}
      </p>
    </div>
    <div class="grid gap-1.5">
      <Label for="profile-when-to-use">When to use</Label>
      <Textarea
        id="profile-when-to-use"
        rows={3}
        maxlength={AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH}
        placeholder="Use when…"
        bind:value={draft.whenToUse}
        aria-describedby="profile-when-to-use-hint"
      />
      <p id="profile-when-to-use-hint" class="text-xs text-muted-foreground">
        The agent reads this to decide when to use the profile. Start with “Use
        when…”.
      </p>
    </div>
    {#if isNew}<div class="grid gap-1.5">
        <Label>Used by</Label>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          value={draft.usableBy}
          onValueChange={(value) => {
            if (value === "lead" || value === "subagent" || value === "both")
              draft.usableBy = value;
          }}
          aria-label="Used by"
        >
          <ToggleGroup.Item value="lead">Agents</ToggleGroup.Item>
          <ToggleGroup.Item value="subagent">Sub-agents</ToggleGroup.Item>
          <ToggleGroup.Item value="both">Both</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" disabled={saving} onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button
      disabled={saving ||
        !agentProfileNameSchema.safeParse(draft.name).success ||
        !draft.whenToUse.trim()}
      onclick={save}
      >{saving ? "Saving…" : isNew ? "Create profile" : "Save"}</Button
    >
  {/snippet}
</DialogShell>
