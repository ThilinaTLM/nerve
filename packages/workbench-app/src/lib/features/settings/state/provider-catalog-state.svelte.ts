import type { CustomProvider, ModelDefinition } from "$lib/api";

export const providerCatalogState = $state({
  catalogLoaded: false,
  customProviders: [] as CustomProvider[],
  modelDefinitions: [] as ModelDefinition[],
});
