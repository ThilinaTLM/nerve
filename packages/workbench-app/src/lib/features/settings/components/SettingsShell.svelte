<script lang="ts">
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

import SettingsPage from "$lib/features/settings/components/SettingsPage.svelte";
import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import {
  loadSettingsSkills,
  queueSettingsSave,
  setTheme,
} from "$lib/features/settings/state/settings-actions.svelte";

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);

$effect(() => {
  const projectId = activeProject?.id;
  if (settingsState.skillsProjectId === (projectId ?? null)) return;
  void loadSettingsSkills(projectId);
});
</script>

<SettingsPage
  {status}
  bind:settingsDraft={settingsState.settingsDraft}
  models={settingsState.models}
  authProviders={settingsState.authProviders}
  {activeProject}
  agentBrowserSkills={settingsState.agentBrowserSkills}
  globalSkills={settingsState.globalSkills}
  projectSkills={settingsState.projectSkills}
  skillsLoading={settingsState.skillsLoading}
  skillsError={settingsState.skillsError}
  onSkillsRetry={() => loadSettingsSkills(activeProject?.id)}
  {settingsSaveStatus}
  {settingsMessage}
  onSettingsChange={queueSettingsSave}
  onThemeChange={setTheme}
/>
