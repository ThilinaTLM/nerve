<script lang="ts">
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import type { Project } from "@nervekit/contracts/core";
import { openProjectSettingsPane } from "$lib/application/settings";
import SettingsView from "$lib/app/composition/settings/SettingsView.svelte";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import {
  pagesByScope,
  settingsPageDetail,
} from "$lib/features/settings/registry/settings-page-data";
import { loadExtensionItems } from "$lib/application/extensions/scoped-extensions-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import {
  loadSettingsSkills,
  queueSettingsSave,
  restartOwnedDaemon,
  saveApplicationConfiguration,
  setTheme,
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
  itemId = $bindable(""),
}: {
  target: SettingsScopeTarget;
  project?: Project;
  pageId?: string;
  sectionId?: string;
  itemId?: string;
} = $props();

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const projectSettingsAction = $derived.by(() => {
  if (target.kind !== "user" || !activeProject) return undefined;
  const { id, name } = activeProject;
  // Switching scope keeps the open page and detail when the project has them.
  const keep = !!settingsPageDetail("project", pageId);
  return {
    name,
    onOpen: () =>
      void openProjectSettingsPane(
        id,
        pageId && Object.hasOwn(pagesByScope.project, pageId)
          ? pageId
          : undefined,
        keep && itemId ? { item: itemId } : {},
      ),
  };
});
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);
const skillsProjectId = $derived(
  target.kind === "project" ? target.projectId : undefined,
);

// The breadcrumb names the open extension; the list is known once the daemon answers.
let extensionItems = $state<{ id: string; label: string }[]>();
$effect(() => {
  if (pageId !== "extensions" || extensionItems) return;
  if (!workbenchStartupState.progressiveActive) return;
  void loadExtensionItems()
    .then((items) => (extensionItems = items))
    .catch(() => undefined);
});

$effect(() => {
  if (settingsState.skillsProjectId === (skillsProjectId ?? null)) return;
  void loadSettingsSkills(skillsProjectId);
});
</script>

<SettingsView
  {target}
  {projectSettingsAction}
  detailItems={extensionItems ? { extensions: extensionItems } : {}}
  {status}
  bind:settingsDraft={settingsState.settingsDraft}
  applicationConfiguration={settingsState.applicationConfiguration}
  daemonCapability={settingsState.daemonCapability}
  daemonRestarting={settingsState.daemonRestarting}
  bind:activePageId={pageId}
  bind:activeSectionId={sectionId}
  bind:activeItemId={itemId}
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
  theme={appearanceState.theme}
  onThemeChange={setTheme}
/>
