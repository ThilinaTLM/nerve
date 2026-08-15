import type { CustomProvider, ModelDefinition } from "$lib/api";

export const authState = $state({
  activePageId: "connections",
  activeSectionId: "subscriptions",
  catalogLoaded: false,
  customProviders: [] as CustomProvider[],
  modelDefinitions: [] as ModelDefinition[],
});
