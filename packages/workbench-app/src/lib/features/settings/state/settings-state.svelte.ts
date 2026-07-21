import type {
  AuthProviderMetadata,
  AvailableSkill,
  ModelInfo,
  Settings,
} from "$lib/api";

export const settingsState = $state({
  models: [] as ModelInfo[],
  authProviders: [] as AuthProviderMetadata[],
  agentBrowserSkills: [] as AvailableSkill[],
  globalSkills: [] as AvailableSkill[],
  projectSkills: [] as AvailableSkill[],
  skillsLoading: false,
  skillsError: undefined as string | undefined,
  skillsProjectId: undefined as string | null | undefined,
  settingsDraft: undefined as Settings | undefined,
  settingsSaveStatus: "idle" as "idle" | "dirty" | "saving" | "saved" | "error",
  settingsMessage: undefined as string | undefined,
  settingsTabOpen: false,
});
