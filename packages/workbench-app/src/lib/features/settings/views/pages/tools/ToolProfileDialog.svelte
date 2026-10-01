<script lang="ts">
import { openSettingsPane } from "$lib/application/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { SelectRow } from "@nervekit/ui-kit/components/composites/select-row";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

type Profile = { id: string; name: string; detail?: string };
type Props = {
  open?: boolean;
  title: string;
  description: string;
  profiles: Profile[];
  selectedProfileId?: string;
  providerSection: "tavily-profiles" | "atlassian-profiles";
  selectionTourId?: string;
  /** Label for clearing the selection; projects use it to inherit. */
  noneLabel?: string;
  /** Explains why the current selection cannot be used. */
  warning?: string;
  /** Optional per-profile connection status shown beside each option. */
  profileStatus?: (
    profileId: string,
  ) => { label: string; tone: StatusTone } | undefined;
  onSave: (profileId: string | undefined) => void;
};

let {
  open = $bindable(false),
  title,
  description,
  profiles,
  selectedProfileId,
  providerSection,
  selectionTourId,
  noneLabel = "No profile",
  warning,
  profileStatus,
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
  <div class="grid gap-2" data-tour-id={selectionTourId}>
    {#if warning}
      <p class="text-xs text-warning" role="alert">{warning}</p>
    {/if}
    <SelectRow
      label={noneLabel}
      selected={draftProfileId === ""}
      onclick={() => (draftProfileId = "")}
    />
    {#each profiles as profile (profile.id)}
      {@const status = profileStatus?.(profile.id)}
      <SelectRow
        label={profile.name}
        detail={profile.detail}
        selected={draftProfileId === profile.id}
        onclick={() => (draftProfileId = profile.id)}
      >
        {#snippet trailing()}
          {#if status}
            <Badge variant={status.tone}>{status.label}</Badge>
          {/if}
        {/snippet}
      </SelectRow>
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
