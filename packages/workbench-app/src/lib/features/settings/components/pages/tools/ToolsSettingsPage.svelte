<script lang="ts">
import type { AuthProviderMetadata, Settings, StatusResponse } from "$lib/api";
import { SettingsSection } from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import BuiltInToolsSection from "./BuiltInToolsSection.svelte";
import IntegrationsSection from "./IntegrationsSection.svelte";

type Props = {
  settingsDraft: Settings;
  status?: StatusResponse;
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  status,
  authProviders = [],
  onSettingsChange,
}: Props = $props();
</script>

<SettingsSection id="built-in" title="Built-in">
  <BuiltInToolsSection
    {settingsDraft}
    {status}
    {authProviders}
    {onSettingsChange}
  />
</SettingsSection>

<SettingsSection id="integrations" title="Integrations">
  <IntegrationsSection
    {settingsDraft}
    {status}
    {authProviders}
    {onSettingsChange}
  />
</SettingsSection>
