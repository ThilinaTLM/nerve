<!-- LLM accounts, subscriptions and custom providers and models. User-only. -->
<script lang="ts">
import type { AuthProviderMetadata, ModelInfo } from "$lib/api";
import { loadProviderCatalog } from "$lib/features/settings/state/provider-catalog-actions.svelte";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import ApiKeysSection from "./ApiKeysSection.svelte";
import CustomModelsSection from "./CustomModelsSection.svelte";
import CustomProvidersSection from "./CustomProvidersSection.svelte";
import SubscriptionsSection from "./SubscriptionsSection.svelte";

type Props = {
  authProviders: AuthProviderMetadata[];
  models: ModelInfo[];
};
let { authProviders, models }: Props = $props();
if (!providerCatalogState.catalogLoaded) void loadProviderCatalog();
</script>

<SubscriptionsSection {authProviders} />
<ApiKeysSection {authProviders} />
<CustomProvidersSection {authProviders} />
<CustomModelsSection {models} {authProviders} />
