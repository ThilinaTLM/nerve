<script lang="ts">
import type { AuthProviderMetadata, Settings } from "$lib/api";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  SettingsGroup,
  SettingsList,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import { atlassianProfileReady } from "../providers/provider-profiles";
import ToolConfigureButton from "./ToolConfigureButton.svelte";
import ToolGroupItem from "./ToolGroupItem.svelte";
import ToolProfileDialog from "./ToolProfileDialog.svelte";
import {
  providerToolGroups,
  type ProviderToolGroup,
} from "./provider-tool-catalog";

type IntegrationId = ProviderToolGroup["id"];
type Props = {
  settingsDraft: Settings;
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};
let { settingsDraft, authProviders = [], onSettingsChange }: Props = $props();
let profileDialogOpen = $state(false);
let profileDialogIntegration = $state<IntegrationId | undefined>();

function selectedProfile(id: IntegrationId) {
  const profileId = settingsDraft.tools[id].profileId;
  return settingsDraft.providers.atlassianProfiles.find(
    (profile) => profile.id === profileId,
  );
}
function ready(id: IntegrationId): boolean {
  return atlassianProfileReady(selectedProfile(id), authProviders);
}
function setEnabled(id: IntegrationId, enabled: boolean): void {
  if (enabled && !ready(id)) return;
  settingsDraft.tools[id].enabled = enabled;
  onSettingsChange?.({ tools: { [id]: { enabled } } }, { immediate: true });
}
function setProfile(id: IntegrationId, profileId: string): void {
  const next = profileId || undefined;
  settingsDraft.tools[id].profileId = next;
  const profile = settingsDraft.providers.atlassianProfiles.find(
    (item) => item.id === next,
  );
  const enabled = atlassianProfileReady(profile, authProviders)
    ? settingsDraft.tools[id].enabled
    : false;
  settingsDraft.tools[id].enabled = enabled;
  onSettingsChange?.(
    { tools: { [id]: { profileId: next ?? null, enabled } } },
    { immediate: true },
  );
}
</script>

<SettingsGroup>
  <SettingsList
    ariaLabel="Third-party provider tools"
    class="border-t border-border/40"
  >
    {#each providerToolGroups as integration (integration.id)}
      <ToolGroupItem
        title={integration.label}
        description={integration.description}
        tools={integration.tools}
      >
        {#snippet actions()}
          <ToolConfigureButton
            label={`Configure ${integration.label}`}
            onclick={() => {
              profileDialogIntegration = integration.id;
              profileDialogOpen = true;
            }}
          />
          <Switch
            size="settings"
            checked={settingsDraft.tools[integration.id].enabled &&
              ready(integration.id)}
            disabled={!ready(integration.id)}
            aria-label={`Enable ${integration.label}`}
            onCheckedChange={(checked) => setEnabled(integration.id, checked)}
          />
        {/snippet}
      </ToolGroupItem>
    {/each}
  </SettingsList>
</SettingsGroup>

{#if profileDialogIntegration}
  <ToolProfileDialog
    bind:open={profileDialogOpen}
    title={`Configure ${profileDialogIntegration === "jira" ? "Jira" : "Confluence"}`}
    description="Select the Atlassian profile used by this integration."
    profiles={settingsDraft.providers.atlassianProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      detail: [profile.siteUrl, profile.email].filter(Boolean).join(" · "),
    }))}
    selectedProfileId={settingsDraft.tools[profileDialogIntegration].profileId}
    providerSection="atlassian-profiles"
    onSave={(profileId) =>
      setProfile(profileDialogIntegration!, profileId ?? "")}
  />
{/if}
