<script lang="ts">
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { loadProviderCatalog } from "$lib/features/settings/state/provider-catalog-actions.svelte";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import type { SettingsChange } from "../settings-change";
import ApiKeysSection from "./ApiKeysSection.svelte";
import AtlassianProfilesSection from "./AtlassianProfilesSection.svelte";
import CustomModelsSection from "./CustomModelsSection.svelte";
import CustomProvidersSection from "./CustomProvidersSection.svelte";
import SubscriptionsSection from "./SubscriptionsSection.svelte";
import TavilyProfilesSection from "./TavilyProfilesSection.svelte";

type Props = {
  settingsDraft: Settings;
  authProviders: AuthProviderMetadata[];
  models: ModelInfo[];
  onSettingsChange?: SettingsChange;
};
let { settingsDraft, authProviders, models, onSettingsChange }: Props =
  $props();
if (!providerCatalogState.catalogLoaded) void loadProviderCatalog();
</script>

<SubscriptionsSection {authProviders} />
<ApiKeysSection {authProviders} />
<CustomProvidersSection {authProviders} />
<CustomModelsSection {models} {authProviders} />
<TavilyProfilesSection {settingsDraft} {authProviders} {onSettingsChange} />
<AtlassianProfilesSection {settingsDraft} {authProviders} {onSettingsChange} />
