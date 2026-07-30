<script lang="ts">
import type { AuthProviderMetadata, Settings, StatusResponse } from "$lib/api";
import type { SettingsChange } from "../settings-change";
import BuiltInToolsTab from "./BuiltInToolsTab.svelte";
import IntegrationsTab from "./IntegrationsTab.svelte";

type Props = {
  activeTabId: string;
  settingsDraft: Settings;
  status?: StatusResponse;
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  activeTabId,
  settingsDraft,
  status,
  authProviders = [],
  onSettingsChange,
}: Props = $props();
</script>

{#if activeTabId === "built-in"}
  <BuiltInToolsTab
    {settingsDraft}
    {status}
    {authProviders}
    {onSettingsChange}
  />
{:else if activeTabId === "integrations"}
  <IntegrationsTab
    {settingsDraft}
    {status}
    {authProviders}
    {onSettingsChange}
  />
{/if}
