import type { CustomProvider, ModelDefinition } from "$lib/api";

export const authState = $state({
  authTabOpen: false,
  activePageId: "connections",
  activeSectionId: "subscriptions",
  catalogLoaded: false,
  customProviders: [] as CustomProvider[],
  modelDefinitions: [] as ModelDefinition[],
});
