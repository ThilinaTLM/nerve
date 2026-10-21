<script lang="ts">
import type {
  AgentProfileConfiguration,
  AgentProfileScope,
} from "@nervekit/contracts/agent-profiles";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsChoiceCards } from "$lib/presentation/settings";
import {
  profileDescription,
  profileLabel,
  profileLayerLabels,
  profileOriginLayer,
} from "$lib/presentation/agent-profiles/profile-layers";

/** Chooses the starting point of a new profile; the full editor opens afterwards. */
let {
  open = $bindable(false),
  scope,
  scopeName,
  profiles,
  onContinue,
}: {
  open?: boolean;
  scope: AgentProfileScope;
  scopeName: string;
  profiles: readonly AgentProfileConfiguration[];
  /** `undefined` starts blank; otherwise the profile to copy. */
  onContinue: (source: AgentProfileConfiguration | undefined) => void;
} = $props();

const blank = "blank";
let choice = $state(blank);

const sources = $derived(profiles.filter((profile) => profile.effective));
const items = $derived([
  {
    value: blank,
    label: "Blank",
    detail: "Inherits everything from the conversation",
  },
  ...sources.map((profile) => {
    const description = profileDescription(profile);
    const layer = profileLayerLabels[profileOriginLayer(profile, scope)];
    return {
      value: profile.name,
      label: `Copy of ${profileLabel(profile)}`,
      detail: description ? `${layer} · ${description}` : layer,
    };
  }),
]);
const description = $derived(
  scope === "project"
    ? `Saved to Project · ${scopeName}, shared with everyone who opens this repo. Every field can be changed afterwards.`
    : "Saved to User, so it is available in all projects. Every field can be changed afterwards.",
);

$effect(() => {
  if (open) choice = blank;
});

function submit(): void {
  open = false;
  onContinue(sources.find((profile) => profile.name === choice));
}
</script>

<DialogShell bind:open title="New agent profile" {description} size="md">
  <div class="grid gap-1.5">
    <span class="text-xs font-medium text-muted-foreground">Start from</span>
    <SettingsChoiceCards {items} bind:value={choice} ariaLabel="Start from" />
  </div>
  {#snippet footer()}
    <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={submit}>Continue</Button>
  {/snippet}
</DialogShell>
