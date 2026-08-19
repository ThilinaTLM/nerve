<script lang="ts">
import { openSettingsPane } from "$lib/features/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { SelectRow } from "@nervekit/ui-kit/components/ui/select-row";

type Profile = { id: string; name: string; detail?: string };
type Props = {
  open?: boolean;
  title: string;
  description: string;
  profiles: Profile[];
  selectedProfileId?: string;
  providerSection: "tavily-profiles" | "atlassian-profiles";
  onSave: (profileId: string | undefined) => void;
};

let {
  open = $bindable(false),
  title,
  description,
  profiles,
  selectedProfileId,
  providerSection,
  onSave,
}: Props = $props();

let draftProfileId = $state("");
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) draftProfileId = selectedProfileId ?? "";
  lastOpen = open;
});

function save(): void {
  onSave(draftProfileId || undefined);
  open = false;
}

function manageProfiles(): void {
  open = false;
  void openSettingsPane("providers", providerSection);
}
</script>

<Dialog bind:open size="sm" {title} {description}>
  <div class="grid gap-2">
    <SelectRow
      label="No profile"
      selected={draftProfileId === ""}
      onclick={() => (draftProfileId = "")}
    />
    {#each profiles as profile (profile.id)}
      <SelectRow
        label={profile.name}
        detail={profile.detail}
        selected={draftProfileId === profile.id}
        onclick={() => (draftProfileId = profile.id)}
      />
    {/each}
    {#if profiles.length === 0}
      <p class="text-xs text-muted-foreground">
        No profiles are available yet. Add one in Providers to enable this tool.
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button size="sm" variant="outline" onclick={manageProfiles}
      >Manage profiles</Button
    >
    <Button size="sm" onclick={save} disabled={profiles.length === 0}
      >Save</Button
    >
  {/snippet}
</Dialog>
