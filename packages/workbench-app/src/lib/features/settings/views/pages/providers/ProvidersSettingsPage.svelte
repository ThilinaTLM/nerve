<!-- LLM accounts, subscriptions and custom providers and models. User-only. -->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
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
let advancedOpen = $state(false);
let catalogError = $state<string | undefined>(undefined);
const providerCount = $derived(providerCatalogState.customProviders.length);
const modelCount = $derived(providerCatalogState.modelDefinitions.length);
if (!providerCatalogState.catalogLoaded) {
  void loadProviderCatalog().catch((error) => {
    catalogError = error instanceof Error ? error.message : String(error);
    advancedOpen = true;
  });
}
</script>

<SubscriptionsSection {authProviders} />
<ApiKeysSection {authProviders} />
<Collapsible.Root bind:open={advancedOpen}>
  <Collapsible.Trigger
    class="group/advanced flex w-full items-center gap-2 rounded-md py-2 text-left text-ui font-semibold text-foreground"
  >
    <ChevronRight
      class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/advanced:rotate-90"
    />
    Advanced
    {#if providerCount || modelCount}
      <span class="text-ui font-normal text-muted-foreground">
        · {providerCount} custom {providerCount === 1
          ? "provider"
          : "providers"}, {modelCount} custom {modelCount === 1
          ? "model"
          : "models"}
      </span>
    {/if}
  </Collapsible.Trigger>
  <Collapsible.Content class="grid gap-6 pt-2">
    {#if catalogError}<Callout
        layout="block"
        tone="destructive"
        text={catalogError}
      />{/if}
    <CustomProvidersSection
      {authProviders}
      onError={() => (advancedOpen = true)}
    />
    <CustomModelsSection
      {models}
      {authProviders}
      onError={() => (advancedOpen = true)}
    />
  </Collapsible.Content>
</Collapsible.Root>
