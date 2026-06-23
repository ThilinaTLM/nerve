import type { CustomProvider, ModelDefinition } from "$lib/api";

export const authState = $state({
  authTabOpen: false,
  catalogLoaded: false,
  customProviders: [] as CustomProvider[],
  modelDefinitions: [] as ModelDefinition[],
});
