<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { AuthProviderMetadata, Settings, TavilyProfile } from "$lib/api";
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

<SettingsSection id="tavily-profiles" title="Tavily profiles">
  {#snippet actions()}
    <Button size="xs" data-tour-id="setup-tavily-add-profile" onclick={openAdd}>
      <Plus class="size-3.5" aria-hidden="true" />
      Add profile
    </Button>
  {/snippet}
  {#if settingsDraft.providers.tavilyProfiles.length === 0}
    <SettingsEmptyState
      class="rounded-md border border-dashed border-border/60 bg-muted/20 px-3"
      title="No Tavily profiles"
      description="Add a named Tavily API key for web search."
    />
  {:else}
    <SettingsList ariaLabel="Tavily profiles" class="grid gap-2 divide-y-0">
      {#each settingsDraft.providers.tavilyProfiles as profile (profile.id)}
        <SettingsListItem
          title={profile.name}
          class="rounded-md border border-border/60 bg-card/40 px-3 py-2"
        >
          {#snippet badges()}
            {#if !configured(profile)}
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
