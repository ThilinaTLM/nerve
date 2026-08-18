<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type {
  AtlassianProfile,
  AuthProviderMetadata,
  Settings,
} from "$lib/api";
import { deleteProviderCredential, getAuthProviders } from "$lib/api";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsListItem,
  SettingsSection,
} from "$lib/presentation/components/settings";
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

<SettingsSection id="atlassian-profiles" title="Atlassian profiles">
  {#snippet actions()}
    <Button size="xs" onclick={openAdd}>
      <Plus class="size-3.5" aria-hidden="true" />
      Add profile
    </Button>
  {/snippet}
  {#if settingsDraft.providers.atlassianProfiles.length === 0}
    <SettingsEmptyState
      class="rounded-md border border-dashed border-border/60 bg-muted/20 px-3"
      title="No Atlassian profiles"
      description="Add a connection for Jira and Confluence."
    />
  {:else}
    <SettingsList ariaLabel="Atlassian profiles" class="grid gap-2 divide-y-0">
      {#each settingsDraft.providers.atlassianProfiles as profile (profile.id)}
        <SettingsListItem
          class="rounded-md border border-border/60 bg-card/40 px-3 py-2"
          title={profile.name}
          description={[profile.siteUrl, profile.email]
            .filter(Boolean)
            .join(" · ") || "Connection details incomplete"}
        >
          {#snippet badges()}
            {#if !atlassianProfileReady(profile, authProviders)}
              <Badge tone="neutral" size="xs">Incomplete</Badge>
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
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

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
