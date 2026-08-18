<script lang="ts">
import { openSettingsPane } from "$lib/features/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";

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
    <RadioGroup.Root bind:value={draftProfileId} class="gap-1">
      <label
        class="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-muted/40"
      >
        <RadioGroup.Item value="" size="sm" aria-label="No profile" />
        <span>No profile</span>
      </label>
      {#each profiles as profile (profile.id)}
        <label
          class="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-muted/40"
        >
          <RadioGroup.Item
            value={profile.id}
            size="sm"
            aria-label={profile.name}
          />
          <span class="grid min-w-0 gap-0.5">
            <span class="truncate">{profile.name}</span>
            {#if profile.detail}
              <span class="truncate text-xs text-muted-foreground"
                >{profile.detail}</span
              >
            {/if}
          </span>
        </label>
      {/each}
    </RadioGroup.Root>
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
