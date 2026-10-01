<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { onMount } from "svelte";
import type { AtlassianProfileHealth } from "@nervekit/contracts/auth";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { onEvent } from "$lib/application/events/event-bus";
import {
  atlassianHealthBadge,
  atlassianHealthDetail,
  atlassianHealthStale,
} from "$lib/presentation/integrations/atlassian-health";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import type {
  AtlassianProfile,
  AuthProviderMetadata,
  Settings,
} from "$lib/api";
import {
  checkIntegrationHealth,
  deleteProviderCredential,
  getAuthProviders,
  listIntegrationHealth,
} from "$lib/api";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/settings";
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
let health = $state<Record<string, AtlassianProfileHealth>>({});
let checking = $state<Record<string, boolean>>({});
let checkErrors = $state<Record<string, string>>({});
/** Saved profiles to test once the daemon has persisted them. Not rendered. */
let awaitingSave: string[] = [];

const services = [
  { id: "jira", label: "Jira" },
  { id: "confluence", label: "Confluence" },
] as const;

async function loadHealth(): Promise<void> {
  try {
    const profiles = await listIntegrationHealth();
    health = Object.fromEntries(profiles.map((item) => [item.profileId, item]));
  } catch {
    // Health is advisory; the profile list stays usable without it.
  }
}

async function testConnection(profileId: string): Promise<void> {
  if (checking[profileId]) return;
  checking[profileId] = true;
  delete checkErrors[profileId];
  try {
    health[profileId] = await checkIntegrationHealth(profileId);
  } catch (cause) {
    checkErrors[profileId] =
      cause instanceof Error ? cause.message : "Could not test the connection.";
  } finally {
    checking[profileId] = false;
  }
}

onMount(() => {
  void (async () => {
    await loadHealth();
    // Re-check stale results once per visit, one profile at a time.
    for (const profile of settingsDraft.providers.atlassianProfiles) {
      if (
        atlassianProfileReady(profile, authProviders) &&
        atlassianHealthStale(health[profile.id])
      )
        await testConnection(profile.id);
    }
  })();
  const unsubscribes = [
    onEvent("auth.integration_health_changed", () => void loadHealth()),
    onEvent("settings.updated", () => {
      const saved = awaitingSave;
      awaitingSave = [];
      for (const profileId of saved) void testConnection(profileId);
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
});

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
  if (!awaitingSave.includes(profile.id))
    awaitingSave = [...awaitingSave, profile.id];
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
  addTourId="setup-atlassian-add-profile"
  emptyTitle="No Atlassian profiles"
  emptyDescription="Add a connection for Jira and Confluence."
  items={settingsDraft.providers.atlassianProfiles}
  listAriaLabel="Atlassian profiles"
  itemKey={(profile) => profile.id}
  onAdd={openAdd}
>
  {#snippet row(profile)}
    <SettingsListItem
      title={profile.name}
      description={[profile.siteUrl, profile.email]
        .filter(Boolean)
        .join(" · ") || "Connection details incomplete"}
    >
      {#snippet status()}
        {#if !atlassianProfileReady(profile, authProviders)}
          <Badge variant="warning">Incomplete</Badge>
        {:else if checkErrors[profile.id]}
          <Badge variant="warning" title={checkErrors[profile.id]}
            >Couldn’t check</Badge
          >
        {:else}
          <Tooltip.Provider delayDuration={200}>
            {#each services as service (service.id)}
              {@const result = health[profile.id]?.[service.id]}
              {@const badge = atlassianHealthBadge(result)}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <span {...props}>
                      <Badge variant={badge.tone}
                        >{service.label}: {badge.label}</Badge
                      >
                    </span>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="top"
                  >{atlassianHealthDetail(result)}</Tooltip.Content
                >
              </Tooltip.Root>
            {/each}
          </Tooltip.Provider>
        {/if}
      {/snippet}
      {#snippet actions()}
        {#if atlassianProfileReady(profile, authProviders)}
          <IconAction
            icon={RefreshCw}
            label={checking[profile.id]
              ? "Testing connection…"
              : "Test connection"}
            busy={checking[profile.id]}
            onclick={() => void testConnection(profile.id)}
          />
        {/if}
        <IconAction
          icon={Pencil}
          label="Edit profile"
          onclick={() => {
            editing = profile;
            dialogOpen = true;
          }}
        />
        <IconAction
          icon={Trash2}
          label="Delete profile"
          tone="destructive"
          onclick={() => (pendingDelete = profile)}
        />
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
