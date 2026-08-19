<script lang="ts">
import type { AuthProviderMetadata, Settings, TavilyProfile } from "$lib/api";
import { deleteProviderCredential, getAuthProviders } from "$lib/api";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/components/settings";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import type { SettingsChange } from "../settings-change";
import {
  credentialConfigured,
  removeTavilyProfilePatch,
  tavilyCredentialId,
  upsertProfile,
} from "./provider-profiles";
import TavilyProfileDialog from "./TavilyProfileDialog.svelte";

type Props = {
  settingsDraft: Settings;
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};
let { settingsDraft, authProviders, onSettingsChange }: Props = $props();
let dialogOpen = $state(false);
let editing = $state<TavilyProfile | undefined>();
let pendingDelete = $state<TavilyProfile | undefined>();

function configured(profile: TavilyProfile): boolean {
  return credentialConfigured(authProviders, tavilyCredentialId(profile.id));
}
function openAdd(): void {
  editing = undefined;
  dialogOpen = true;
}
function save(profile: TavilyProfile): void {
  const profiles = upsertProfile(
    settingsDraft.providers.tavilyProfiles,
    profile,
  );
  settingsDraft.providers.tavilyProfiles = profiles;
  onSettingsChange?.(
    { providers: { tavilyProfiles: profiles } },
    { immediate: true },
  );
}
async function remove(): Promise<void> {
  const profile = pendingDelete;
  if (!profile) return;
  try {
    await deleteProviderCredential(tavilyCredentialId(profile.id));
    const patch = removeTavilyProfilePatch(settingsDraft, profile.id);
    settingsDraft.providers.tavilyProfiles =
      patch.providers?.tavilyProfiles ?? [];
    if (patch.tools?.web) settingsDraft.tools.web.tavilyProfileId = undefined;
    if (patch.tools?.disabled)
      settingsDraft.tools.disabled = patch.tools.disabled;
    onSettingsChange?.(patch, { immediate: true });
    settingsState.authProviders = await getAuthProviders();
  } finally {
    pendingDelete = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="tavily-profiles"
  title="Tavily profiles"
  addLabel="Add profile"
  addTourId="setup-tavily-add-profile"
  emptyTitle="No Tavily profiles"
  emptyDescription="Add a named Tavily API key for web search."
  items={settingsDraft.providers.tavilyProfiles}
  listAriaLabel="Tavily profiles"
  itemKey={(profile) => profile.id}
  onAdd={openAdd}
>
  {#snippet row(profile)}
    <SettingsListItem variant="card" title={profile.name}>
      {#snippet meta()}
        {#if !configured(profile)}
          <span class="text-warning">Incomplete</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        <Button
          variant="ghost"
          size="xs"
          onclick={() => {
            editing = profile;
            dialogOpen = true;
          }}>Edit</Button
        >
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (pendingDelete = profile)}>Delete</Button
        >
      {/snippet}
    </SettingsListItem>
  {/snippet}
</SettingsEntityListSection>

<TavilyProfileDialog
  bind:open={dialogOpen}
  profile={editing}
  configured={editing ? configured(editing) : false}
  onSave={save}
/>
<ConfirmDialog
  open={!!pendingDelete}
  title="Delete Tavily profile?"
  description={pendingDelete
    ? `Delete “${pendingDelete.name}” and its stored API key?`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => void remove()}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
