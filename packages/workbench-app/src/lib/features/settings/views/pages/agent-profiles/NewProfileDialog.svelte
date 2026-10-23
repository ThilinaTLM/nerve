<!-- Create a profile: blank, or a copy of an existing one. Saved as one JSON file. -->
<script lang="ts">
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { AGENT_PROFILE_LABEL_MAX_LENGTH } from "@nervekit/contracts/agent-profiles";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { nameFromLabel } from "./profile-changes";
import { profileKindText, type ProfileKind } from "./profile-kind";

type Props = {
  open?: boolean;
  kind: ProfileKind;
  scope: "user" | "project";
  /** Every profile file in this scope; used for name clashes. */
  profiles: ProfileCatalogEntry[];
  error?: string;
  onCreate: (input: {
    label: string;
    name: string;
    copyOf?: string;
    description: string;
  }) => void;
};
let {
  open = $bindable(false),
  kind,
  scope,
  profiles,
  error,
  onCreate,
}: Props = $props();

const text = $derived(profileKindText[kind]);
const copyable = $derived(
  profiles.filter(
    (profile) =>
      profile.definition &&
      (kind === "lead"
        ? profile.definition.usableBy !== "subagent"
        : profile.definition.usableBy !== "lead"),
  ),
);
let label = $state("");
let description = $state("");
let from = $state<"blank" | "copy">("blank");
let copyOf = $state("");
let lastOpen = false;
$effect(() => {
  if (open && !lastOpen) {
    label = "";
    description = "";
    from = "blank";
    copyOf = copyable[0]?.name ?? "";
  }
  lastOpen = open;
});
const name = $derived(nameFromLabel(label));
const taken = $derived(profiles.some((profile) => profile.name === name));
const valid = $derived(
  label.trim().length > 0 &&
    name.length > 0 &&
    !taken &&
    (from === "copy" || description.trim().length > 0) &&
    (from === "blank" || copyOf),
);

function create(): void {
  if (!valid) return;
  onCreate({
    label: label.trim(),
    description: description.trim(),
    name,
    copyOf: from === "copy" ? copyOf : undefined,
  });
}
</script>

<Dialog
  bind:open
  size="sm"
  title={scope === "project"
    ? `New project ${text.singularLower}`
    : `New ${text.singularLower}`}
  description="Saved as one JSON file you can edit or share."
>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <Label>Start from</Label>
      <ToggleGroup.Root
        type="single"
        variant="chip"
        size="sm"
        aria-label="Start from"
        value={from}
        onValueChange={(next) => next && (from = next as typeof from)}
      >
        <ToggleGroup.Item value="blank">Blank</ToggleGroup.Item>
        <ToggleGroup.Item value="copy" disabled={copyable.length === 0}
          >Copy of {text.singularLower === "agent" ? "an" : "a"}
          {text.singularLower}</ToggleGroup.Item
        >
      </ToggleGroup.Root>
      {#if from === "copy"}
        <SelectField
          items={copyable.map((profile) => ({
            value: profile.name,
            label: profile.definition?.label ?? profile.name,
          }))}
          value={copyOf}
          ariaLabel={`${text.singular} to copy`}
          onValueChange={(next) => (copyOf = next)}
        />
      {/if}
    </div>
    <div class="grid gap-1.5">
      <Label for="new-profile-description">Description</Label><Textarea
        id="new-profile-description"
        bind:value={description}
        placeholder="What this profile is for"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="new-profile-label">Label</Label>
      <Input
        id="new-profile-label"
        bind:value={label}
        maxlength={AGENT_PROFILE_LABEL_MAX_LENGTH}
      />
      <p
        class={taken
          ? "text-xs text-destructive"
          : "text-xs text-muted-foreground"}
      >
        {#if taken}A profile file named {name} already exists.{:else if name}File
          name: <span class="font-mono">{name}.json</span>{:else}The file name
          comes from the label.{/if}
      </p>
    </div>
    {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button disabled={!valid} onclick={create}
      >Create {text.singularLower}</Button
    >
  {/snippet}
</Dialog>
