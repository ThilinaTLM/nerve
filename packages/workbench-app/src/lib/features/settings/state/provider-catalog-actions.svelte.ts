import { getProviderCatalog } from "$lib/api";
import { loadSettingsPanel } from "$lib/application/settings";
import { providerCatalogState } from "./provider-catalog-state.svelte";

let loadInFlight: Promise<void> | undefined;

export function loadProviderCatalog(): Promise<void> {
  if (loadInFlight) return loadInFlight;
  loadInFlight = getProviderCatalog()
    .then((catalog) => {
      providerCatalogState.customProviders = catalog.providers;
      providerCatalogState.modelDefinitions = catalog.models;
      providerCatalogState.catalogLoaded = true;
    })
    .finally(() => {
      loadInFlight = undefined;
    });
  return loadInFlight;
}

export async function refreshProviderCatalog(): Promise<void> {
  await loadProviderCatalog();
  await loadSettingsPanel();
}
