<script lang="ts">
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import { attentionCounts } from "$lib/application/configuration-attention/configuration-attention";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import SettingsView from "$lib/app/composition/settings/SettingsView.svelte";
import {
  projectSettingsScope,
  userSettingsScope,
} from "$lib/features/settings/registry/settings-scope";
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
 * The one settings surface. The open project (the active workspace project)
 * adds a column on layered pages and a nav group of its own; without one the
 * surface is User only.
 */
let {
  pageId = $bindable(),
  sectionId = $bindable(),
  itemId = $bindable(""),
}: {
  pageId?: string;
  sectionId?: string;
  itemId?: string;
} = $props();

const status = $derived(workspaceSelectors.status);
const scopeProject = $derived(workspaceSelectors.activeProject ?? undefined);
const target = $derived(
  scopeProject ? projectSettingsScope(scopeProject.id) : userSettingsScope,
);
const entries = $derived(configurationAttention.entriesFor(scopeProject?.id));
const counts = $derived(attentionCounts(entries));
// What needs the user in User's settings and in the open project.
const attention = $derived({
  pages: Object.fromEntries(
    Object.keys({ ...counts.pages.user, ...counts.pages.project }).map((id) => [
      id,
      (counts.pages.user[id] ?? 0) + (counts.pages.project[id] ?? 0),
    ]),
  ),
});
const settingsSaveStatus = $derived(settingsSelectors.settingsSaveStatus);
const settingsMessage = $derived(settingsSelectors.settingsMessage);
const skillsProjectId = $derived(scopeProject?.id);

// A project's own skills open a review page; known once this project's list is in.
const skillItems = $derived(
  scopeProject && settingsState.skillsProjectId === scopeProject.id
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
$effect(() => {
  void scopeProject?.id;
  extensionItemsStale = true;
});
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
    scopeProject
      ? { scope: "project", projectId: scopeProject.id }
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
  {attention}
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
  project={scopeProject}
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
