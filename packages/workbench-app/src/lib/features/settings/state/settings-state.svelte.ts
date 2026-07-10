import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";

export const settingsState = $state({
  models: [] as ModelInfo[],
  authProviders: [] as AuthProviderMetadata[],
  settingsDraft: undefined as Settings | undefined,
  settingsSaveStatus: "idle" as "idle" | "dirty" | "saving" | "saved" | "error",
  settingsMessage: undefined as string | undefined,
  settingsTabOpen: false,
});
