<script lang="ts">
import Search from "@lucide/svelte/icons/search";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import type { AuthProviderMetadata, Settings, TavilyProfile } from "$lib/api";
import { deleteProviderCredential, getAuthProviders } from "$lib/api";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { SettingsItem } from "$lib/presentation/settings";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import type { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { accountOptions } from "../tools/tool-settings";
import IntegrationAccountUsage from "./IntegrationAccountUsage.svelte";
import { accountUsedEverywhere, useAccountEverywhere } from "./account-usage";
import ListChecks from "@lucide/svelte/icons/list-checks";
import type { SettingsChange } from "../settings-change";
import {
  credentialConfigured,
  removeTavilyProfilePatch,
  tavilyCredentialId,
  upsertProfile,
} from "../providers/provider-profiles";
import TavilyProfileDialog from "./TavilyAccountDialog.svelte";

type Props = {
  settingsDraft: Settings;
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
  /** User-scope tool settings; tools using these accounts are picked below the list. */
  tools: ScopedAgentState;
};
let { settingsDraft, authProviders, onSettingsChange, tools }: Props = $props();
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
function openEdit(profile: TavilyProfile): void {
  editing = profile;
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
    onSettingsChange?.(patch, { immediate: true });
    settingsState.authProviders = await getAuthProviders();
  } finally {
    pendingDelete = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="tavily-accounts"
  title="Tavily (web search)"
  addLabel="Add account"
  addTourId="setup-tavily-add-profile"
  emptyTitle="No Tavily accounts"
  emptyDescription="Add a named Tavily API key for web search."
  items={settingsDraft.providers.tavilyProfiles}
  listAriaLabel="Tavily (web search)"
  itemKey={(profile) => profile.id}
  onAdd={openAdd}
>
  {#snippet footer()}
    <IntegrationAccountUsage
      kind="tavily"
      accounts={accountOptions(settingsDraft.providers).tavily}
      editor={tools}
    />
  {/snippet}
  {#snippet row(profile)}
    <SettingsItem
      title={profile.name}
      icon={Search}
      summary="API key stored"
      problem={configured(profile) ? undefined : "API key missing"}
      problemAction={{ label: "Add key", onclick: () => openEdit(profile) }}
      onOpen={() => openEdit(profile)}
      openLabel={`Edit ${profile.name}`}
    >
      {#snippet actions()}
        {#if tools.resolution && !accountUsedEverywhere("tavily", tools.resolution.settings.tools ?? {}, profile.id)}
          <IconAction
            icon={ListChecks}
            label="Use for all web search tools"
            disabled={tools.saving}
            onclick={() =>
              void tools.save(useAccountEverywhere("tavily", profile.id))}
          />
        {/if}
        <IconAction
          icon={Trash2}
          label="Delete account"
          tone="destructive"
          onclick={() => (pendingDelete = profile)}
        />
      {/snippet}
    </SettingsItem>
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
  title="Delete Tavily account?"
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
