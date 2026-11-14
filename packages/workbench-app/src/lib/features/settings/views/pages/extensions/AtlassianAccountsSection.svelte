<script lang="ts">
import SquareKanban from "@lucide/svelte/icons/square-kanban";
import Trash2 from "@lucide/svelte/icons/trash-2";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { onMount } from "svelte";
import type { AtlassianProfileHealth } from "@nervekit/contracts/auth";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import {
  atlassianHealthBadge,
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
import { SettingsItem } from "$lib/presentation/settings";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import type { SettingsChange } from "../settings-change";
import AtlassianProfileDialog from "./AtlassianAccountDialog.svelte";
import {
  atlassianCredentialId,
  atlassianProfileReady,
  credentialConfigured,
  removeAtlassianProfilePatch,
  upsertProfile,
} from "../providers/provider-profiles";

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

function openEdit(profile: AtlassianProfile): void {
  editing = profile;
  dialogOpen = true;
}
/** Normal state: per-service results. Rejected, restricted or unreachable ones are problems. */
function healthStatus(profile: AtlassianProfile): {
  summary: string;
  problem?: string;
  retry: boolean;
} {
  const results = services.map((service) => ({
    service,
    badge: atlassianHealthBadge(health[profile.id]?.[service.id]),
  }));
  const problems = results.filter(
    ({ badge }) => badge.tone === "destructive" || badge.tone === "warning",
  );
  return {
    summary: [
      profile.siteUrl,
      ...results.map(
        ({ service, badge }) => `${service.label} ${badge.label.toLowerCase()}`,
      ),
    ]
      .filter(Boolean)
      .join(" · "),
    problem: problems.length
      ? problems
          .map(({ service, badge }) => `${service.label}: ${badge.label}`)
          .join(", ")
      : undefined,
    retry: problems.every(({ badge }) => badge.tone === "warning"),
  };
}
function hasToken(profile: AtlassianProfile): boolean {
  return credentialConfigured(authProviders, atlassianCredentialId(profile.id));
}
export function openAdd(): void {
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
    onSettingsChange?.(patch, { immediate: true });
    settingsState.authProviders = await getAuthProviders();
  } finally {
    pendingDelete = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="accounts"
  title="Atlassian accounts"
  addLabel="Add account"
  addTourId="setup-atlassian-add-profile"
  emptyTitle="No Atlassian accounts"
  emptyDescription="Add a connection for Jira and Confluence."
  items={settingsDraft.providers.atlassianProfiles}
  listAriaLabel="Atlassian accounts"
  itemKey={(profile) => profile.id}
  onAdd={openAdd}
>
  {#snippet row(profile)}
    {@const ready = atlassianProfileReady(profile, authProviders)}
    {@const status = healthStatus(profile)}
    {@const checkError = checkErrors[profile.id]}
    <SettingsItem
      title={profile.name}
      icon={SquareKanban}
      summary={status.summary}
      problem={!ready
        ? "Connection details incomplete"
        : checkError
          ? "Couldn’t check the connection"
          : status.problem}
      problemAction={!ready
        ? { label: "Complete", onclick: () => openEdit(profile) }
        : checkError || status.retry
          ? { label: "Retry", onclick: () => void testConnection(profile.id) }
          : { label: "Edit", onclick: () => openEdit(profile) }}
      onOpen={() => openEdit(profile)}
      openLabel={`Edit ${profile.name}`}
    >
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
          icon={Trash2}
          label="Delete account"
          tone="destructive"
          onclick={() => (pendingDelete = profile)}
        />
      {/snippet}
    </SettingsItem>
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
  title="Delete Atlassian account?"
  description={pendingDelete
    ? `Delete “${pendingDelete.name}”, its stored token, and unselect it wherever extensions use it?`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => void remove()}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
