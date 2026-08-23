<script lang="ts">
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

import SettingsPage from "$lib/app/composition/settings/SettingsView.svelte";
import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { listTools } from "$lib/features/tools/api/tools.api";
import {
  loadSettingsSkills,
  queueSettingsSave,
  restartOwnedDaemon,
  saveApplicationConfiguration,
  setColorMode,
  setColorTheme,
} from "$lib/application/settings/settings-actions.svelte";

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);

$effect(() => {
  const projectId = activeProject?.id;
  if (settingsState.skillsProjectId === (projectId ?? null)) return;
  void loadSettingsSkills(projectId);
});

$effect(() => {
  if (
    settingsState.activePageId !== "permissions" ||
    settingsState.toolDescriptorsLoaded ||
    settingsState.toolDescriptorsLoading
  )
    return;
  settingsState.toolDescriptorsLoading = true;
  void listTools()
    .then((tools) => {
      settingsState.toolDescriptors = tools;
      settingsState.toolDescriptorsLoaded = true;
    })
    .finally(() => {
      settingsState.toolDescriptorsLoading = false;
    });
});
</script>

<SettingsPage
  {status}
  bind:settingsDraft={settingsState.settingsDraft}
  applicationConfiguration={settingsState.applicationConfiguration}
  daemonCapability={settingsState.daemonCapability}
  daemonRestarting={settingsState.daemonRestarting}
  bind:activePageId={settingsState.activePageId}
  bind:activeSectionId={settingsState.activeSectionId}
  models={settingsState.models}
  authProviders={settingsState.authProviders}
  toolDescriptors={settingsState.toolDescriptors}
  toolDescriptorsLoading={settingsState.toolDescriptorsLoading}
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
  onApplicationConfigurationChange={saveApplicationConfiguration}
  onRestartDaemon={restartOwnedDaemon}
  onColorThemeChange={setColorTheme}
  onColorModeChange={setColorMode}
/>
