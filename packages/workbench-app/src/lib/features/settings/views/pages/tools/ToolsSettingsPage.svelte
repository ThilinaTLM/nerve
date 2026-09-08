<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelInfo,
  Settings,
  StatusResponse,
} from "$lib/api";
import { SettingsList, SettingsSection } from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import ToolCatalogSection from "./ToolCatalogSection.svelte";
import ThirdPartyProviderToolsSection from "./ThirdPartyProviderToolsSection.svelte";

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

<SettingsSection id="core" title="Core">
  <SettingsList ariaLabel="Core tool groups">
    <ToolCatalogSection
      {settingsDraft}
      {status}
      {authProviders}
      {models}
      {onSettingsChange}
      category="core"
    />
  </SettingsList>
</SettingsSection>

<SettingsSection id="third-party" title="Third party">
  <SettingsList ariaLabel="Third-party tool groups">
    <ToolCatalogSection
      {settingsDraft}
      {status}
      {authProviders}
      {models}
      {onSettingsChange}
      category="third-party"
    />

    <ThirdPartyProviderToolsSection
      {settingsDraft}
      {authProviders}
      {onSettingsChange}
    />
  </SettingsList>
</SettingsSection>
