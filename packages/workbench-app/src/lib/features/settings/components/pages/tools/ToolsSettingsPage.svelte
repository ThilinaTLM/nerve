<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelInfo,
  Settings,
  StatusResponse,
} from "$lib/api";
import { SettingsSection } from "$lib/presentation/components/settings";
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
  <ToolCatalogSection
    {settingsDraft}
    {status}
    {authProviders}
    {models}
    {onSettingsChange}
    category="core"
  />
</SettingsSection>

<SettingsSection id="third-party" title="Third Party">
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
</SettingsSection>
