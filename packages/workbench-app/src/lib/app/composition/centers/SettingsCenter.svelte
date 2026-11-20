<script lang="ts">
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import type { Project } from "@nervekit/contracts/core";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import { attentionCounts } from "$lib/application/configuration-attention/configuration-attention";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { projectGuides } from "$lib/application/configuration-attention/project-guides";
import { projectGuidesState } from "$lib/application/configuration-attention/project-guides-state.svelte";
import SettingsView from "$lib/app/composition/settings/SettingsView.svelte";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import {
  pagesByScope,
  settingsPageDetail,
} from "$lib/features/settings/registry/settings-page-data";
import { loadExtensionItems } from "$lib/application/extensions/scoped-extensions-state.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
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
// The project this tab is about: its own, or the open project in user settings.
const scopeProject = $derived(
  target.kind === "project" ? project : (activeProject ?? undefined),
);
const entries = $derived(configurationAttention.entriesFor(scopeProject?.id));
const counts = $derived(attentionCounts(entries));
const scopeLinks = $derived({
  // Switching scope keeps the open page and detail when the other scope has them.
  onOpenUser: () =>
    void openSettingsPane(
      pageId && Object.hasOwn(pagesByScope.user, pageId) ? pageId : undefined,
      settingsPageDetail("user", pageId) && itemId ? { item: itemId } : {},
    ),
  ...(scopeProject
    ? {
        project: {
          id: scopeProject.id,
          name: scopeProject.name,
          path: scopeProject.directory,
          onOpen: () =>
            void openProjectSettingsPane(
              scopeProject.id,
              pageId && Object.hasOwn(pagesByScope.project, pageId)
                ? pageId
                : undefined,
              settingsPageDetail("project", pageId) && itemId
                ? { item: itemId }
                : {},
            ),
        },
      }
    : {}),
});
const attention = $derived({
  project: counts.project,
  pages: counts.pages[target.kind],
});

// "In this project" rows on user pages: what the open project brings.
$effect(() => {
  if (target.kind !== "user" || !workbenchStartupState.progressiveActive)
    return;
  void configurationAttention.resources;
  void projectGuidesState.load(activeProject?.id);
});
const guides = $derived(
  target.kind === "user" &&
    activeProject &&
    projectGuidesState.projectId === activeProject.id
    ? projectGuides({
        projectName: activeProject.name,
        skills: projectGuidesState.skills,
        projectExtensions: projectGuidesState.projectExtensions,
        pending: counts.pages.project,
      })
    : {},
);
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);
const skillsProjectId = $derived(
  target.kind === "project" ? target.projectId : undefined,
);

// A project's own skills open a review page; known once this project's list is in.
const skillItems = $derived(
  target.kind === "project" &&
    settingsState.skillsProjectId === target.projectId
    ? settingsState.skills
        .filter((skill) => skill.source === "project")
        .map((skill) => ({ id: skill.name, label: skill.name }))
    : undefined,
);

// The breadcrumb names the open extension, and the shell opens only listed
// items, so the list follows this tab's scope (project extensions included)
// and refreshes when extensions change (install, consent, reload).
let extensionItems = $state<{ id: string; label: string }[]>();
let extensionItemsStale = $state(true);
$effect(() =>
  onEvent("extensions.changed", () => {
    extensionItemsStale = true;
  }),
);
$effect(() => {
  if (pageId !== "extensions" || !extensionItemsStale) return;
  if (!workbenchStartupState.progressiveActive) return;
  extensionItemsStale = false;
  void loadExtensionItems(
    target.kind === "project"
      ? { scope: "project", projectId: target.projectId }
      : { scope: "user" },
  )
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
  {scopeLinks}
  {attention}
  {guides}
  detailItems={{
    ...(extensionItems ? { extensions: extensionItems } : {}),
    ...(skillItems ? { skills: skillItems } : {}),
  }}
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
