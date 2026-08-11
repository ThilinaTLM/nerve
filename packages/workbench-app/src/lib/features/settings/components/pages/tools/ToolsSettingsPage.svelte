<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelInfo,
  Settings,
  StatusResponse,
} from "$lib/api";
import { SettingsSection } from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import BuiltInToolsSection from "./BuiltInToolsSection.svelte";
import IntegrationsSection from "./IntegrationsSection.svelte";

type Props = {
  settingsDraft: Settings;
  status?: StatusResponse;
  authProviders?: AuthProviderMetadata[];
  models?: ModelInfo[];
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  status,
  authProviders = [],
  models = [],
  onSettingsChange,
}: Props = $props();
</script>

<SettingsSection id="built-in" title="Built-in">
  <BuiltInToolsSection
    {settingsDraft}
    {status}
    {authProviders}
    {models}
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
