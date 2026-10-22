<!-- Create a profile: blank, or a copy of an existing one. Saved as one JSON file. -->
<script lang="ts">
import type {
  AgentProfileConfiguration,
  AgentProfileUsableBy,
} from "@nervekit/contracts/agent-profiles";
import { AGENT_PROFILE_LABEL_MAX_LENGTH } from "@nervekit/contracts/agent-profiles";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { nameFromLabel } from "./profile-changes";

type Props = {
  open?: boolean;
  scope: "user" | "project";
  profiles: AgentProfileConfiguration[];
  error?: string;
  onCreate: (input: {
    label: string;
    name: string;
    usableBy: AgentProfileUsableBy;
    copyOf?: string;
  }) => void;
};
let {
  open = $bindable(false),
  scope,
  profiles,
  error,
  onCreate,
}: Props = $props();

const usableItems = [
  { value: "lead", label: "Main agent" },
  { value: "subagent", label: "Sub-agent" },
  { value: "both", label: "Main agent and sub-agent" },
];
let label = $state("");
let usableBy = $state<AgentProfileUsableBy>("lead");
let from = $state<"blank" | "copy">("blank");
let copyOf = $state("");
let lastOpen = false;
$effect(() => {
  if (open && !lastOpen) {
    label = "";
    usableBy = "lead";
    from = "blank";
    copyOf = profiles.find((profile) => profile.effective)?.name ?? "";
  }
  lastOpen = open;
});
const name = $derived(nameFromLabel(label));
const taken = $derived(profiles.some((profile) => profile.name === name));
const valid = $derived(
  label.trim().length > 0 &&
    name.length > 0 &&
    !taken &&
    (from === "blank" || copyOf),
);

function create(): void {
  if (!valid) return;
  onCreate({
    label: label.trim(),
    name,
    usableBy,
    copyOf: from === "copy" ? copyOf : undefined,
  });
}
</script>

<Dialog
  bind:open
  size="sm"
  title={scope === "project" ? "New project profile" : "New profile"}
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
        <ToggleGroup.Item value="copy">Copy of a profile</ToggleGroup.Item>
      </ToggleGroup.Root>
      {#if from === "copy"}
        <SelectField
          items={profiles
            .filter((profile) => profile.effective)
            .map((profile) => ({
              value: profile.name,
              label: profile.effective?.label ?? profile.name,
            }))}
          value={copyOf}
          ariaLabel="Profile to copy"
          onValueChange={(next) => (copyOf = next)}
        />
      {/if}
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
        {#if taken}A profile named {name} already exists.{:else if name}File
          name: <span class="font-mono">{name}.json</span>{:else}The file name
          comes from the label.{/if}
      </p>
    </div>
    <div class="grid gap-1.5">
      <Label>Usable by</Label>
      <SelectField
        items={usableItems}
        value={usableBy}
        ariaLabel="Usable by"
        onValueChange={(next) => (usableBy = next as AgentProfileUsableBy)}
      />
    </div>
    {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button disabled={!valid} onclick={create}>Create profile</Button>
  {/snippet}
</Dialog>
