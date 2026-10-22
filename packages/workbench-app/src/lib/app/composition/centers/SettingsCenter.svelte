<script lang="ts">
import type { Project } from "@nervekit/contracts/core";
import { openProjectSettingsPane } from "$lib/application/settings";
import SettingsView from "$lib/app/composition/settings/SettingsView.svelte";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import {
  loadSettingsSkills,
  queueSettingsSave,
  restartOwnedDaemon,
  saveApplicationConfiguration,
  setColorMode,
  setColorTheme,
} from "$lib/application/settings/settings-actions.svelte";

/**
 * A settings tab for one fixed target. The target is read once from the tab's
 * identity, so switching the active project never retargets an open view.
 */
let {
  target,
  project,
  pageId = $bindable(),
  sectionId = $bindable(),
}: {
  target: SettingsScopeTarget;
  project?: Project;
  pageId?: string;
  sectionId?: string;
} = $props();

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const projectSettingsAction = $derived.by(() => {
  if (target.kind !== "user" || !activeProject) return undefined;
  const { id, name } = activeProject;
  return { name, onOpen: () => void openProjectSettingsPane(id) };
});
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);
const skillsProjectId = $derived(
  target.kind === "project" ? target.projectId : undefined,
);

$effect(() => {
  if (settingsState.skillsProjectId === (skillsProjectId ?? null)) return;
  void loadSettingsSkills(skillsProjectId);
});
</script>

<SettingsView
  {target}
  {projectSettingsAction}
  {status}
  bind:settingsDraft={settingsState.settingsDraft}
  applicationConfiguration={settingsState.applicationConfiguration}
  daemonCapability={settingsState.daemonCapability}
  daemonRestarting={settingsState.daemonRestarting}
  bind:activePageId={pageId}
  bind:activeSectionId={sectionId}
  models={settingsState.models}
  authProviders={settingsState.authProviders}
  {project}
  skills={settingsState.skills}
  skillsLoading={settingsState.skillsLoading}
  skillsError={settingsState.skillsError}
  onSkillsRetry={() => loadSettingsSkills(skillsProjectId)}
  {settingsSaveStatus}
  {settingsMessage}
  onSettingsChange={queueSettingsSave}
  onApplicationConfigurationChange={saveApplicationConfiguration}
  onRestartDaemon={restartOwnedDaemon}
  onColorThemeChange={setColorTheme}
  onColorModeChange={setColorMode}
/>
