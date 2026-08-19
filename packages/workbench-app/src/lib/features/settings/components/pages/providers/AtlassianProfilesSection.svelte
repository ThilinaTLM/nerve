<script lang="ts">
import type {
  AtlassianProfile,
  AuthProviderMetadata,
  Settings,
} from "$lib/api";
import { deleteProviderCredential, getAuthProviders } from "$lib/api";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/components/settings";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import type { SettingsChange } from "../settings-change";
import AtlassianProfileDialog from "./AtlassianProfileDialog.svelte";
import {
  atlassianCredentialId,
  atlassianProfileReady,
  credentialConfigured,
  removeAtlassianProfilePatch,
  upsertProfile,
} from "./provider-profiles";

type Props = {
  settingsDraft: Settings;
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};
let { settingsDraft, authProviders, onSettingsChange }: Props = $props();
let dialogOpen = $state(false);
let editing = $state<AtlassianProfile | undefined>();
let pendingDelete = $state<AtlassianProfile | undefined>();

function hasToken(profile: AtlassianProfile): boolean {
  return credentialConfigured(authProviders, atlassianCredentialId(profile.id));
}
function openAdd(): void {
  editing = undefined;
  dialogOpen = true;
}
function save(profile: AtlassianProfile): void {
  const profiles = upsertProfile(
    settingsDraft.providers.atlassianProfiles,
    profile,
  );
  settingsDraft.providers.atlassianProfiles = profiles;
  onSettingsChange?.(
    { providers: { atlassianProfiles: profiles } },
    { immediate: true },
  );
}
async function remove(): Promise<void> {
  const profile = pendingDelete;
  if (!profile) return;
  try {
    await deleteProviderCredential(atlassianCredentialId(profile.id));
    const patch = removeAtlassianProfilePatch(settingsDraft, profile.id);
    settingsDraft.providers.atlassianProfiles =
      patch.providers?.atlassianProfiles ?? [];
    if (patch.tools?.jira) {
      settingsDraft.tools.jira.enabled = false;
      settingsDraft.tools.jira.profileId = undefined;
    }
    if (patch.tools?.confluence) {
      settingsDraft.tools.confluence.enabled = false;
      settingsDraft.tools.confluence.profileId = undefined;
    }
    onSettingsChange?.(patch, { immediate: true });
    settingsState.authProviders = await getAuthProviders();
  } finally {
    pendingDelete = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="atlassian-profiles"
  title="Atlassian profiles"
  addLabel="Add profile"
  emptyTitle="No Atlassian profiles"
  emptyDescription="Add a connection for Jira and Confluence."
  items={settingsDraft.providers.atlassianProfiles}
  listAriaLabel="Atlassian profiles"
  itemKey={(profile) => profile.id}
  onAdd={openAdd}
>
  {#snippet row(profile)}
    <SettingsListItem
      variant="card"
      title={profile.name}
      description={[profile.siteUrl, profile.email]
        .filter(Boolean)
        .join(" · ") || "Connection details incomplete"}
    >
      {#snippet meta()}
        {#if !atlassianProfileReady(profile, authProviders)}
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

<AtlassianProfileDialog
  bind:open={dialogOpen}
  profile={editing}
  configured={editing ? hasToken(editing) : false}
  onSave={save}
/>
<ConfirmDialog
  open={!!pendingDelete}
  title="Delete Atlassian profile?"
  description={pendingDelete
    ? `Delete “${pendingDelete.name}”, its stored token, and disable tools that use it?`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => void remove()}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
