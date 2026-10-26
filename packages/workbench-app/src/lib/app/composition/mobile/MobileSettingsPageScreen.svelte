<script lang="ts">
import { untrack } from "svelte";
import type { Project } from "@nervekit/contracts/core";
import { MobileScreen } from "$lib/presentation/shell";
import {
  resolveSettingsPageId,
  settingsPageFor,
} from "$lib/features/settings/registry/settings-pages";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { settingsSelectors } from "$lib/features/settings";
import {
  loadSettingsPanel,
  loadSettingsSkills,
  queueSettingsSave,
  restartOwnedDaemon,
  saveApplicationConfiguration,
  setColorMode,
  setColorTheme,
} from "$lib/application/settings/settings-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";
import SettingsPageActions from "../settings/SettingsPageActions.svelte";
import SettingsPageContent from "../settings/SettingsPageContent.svelte";
import { createSettingsPageControllers } from "../settings/settings-page-controllers.svelte";

/**
 * One settings page as a phone screen. The body is the desktop page component;
 * only the navigation around it (sidebar, section links) is phone-native. The
 * target comes from the route, so the active project never retargets it.
 */
let {
  target,
  project,
  pageId,
  backLabel,
}: {
  target: SettingsScopeTarget;
  project?: Project;
  pageId: string;
  backLabel: string;
} = $props();

// Routes can outlive the registry (restored state); unknown pages show the default.
const page = $derived(
  settingsPageFor(target, resolveSettingsPageId(target.kind, pageId)),
);
const status = $derived(workspaceSelectors.status);
const controllers = createSettingsPageControllers({
  target: () => target,
  project: () => project,
});
const skillsProjectId = $derived(
  target.kind === "project" ? target.projectId : undefined,
);
const saveLabel = $derived.by(() => {
  const message = settingsSelectors.settingsMessage;
  if (message) return message;
  switch (settingsSelectors.settingsSaveStatus) {
    case "saving":
      return "Saving…";
    case "dirty":
      return "Unsaved changes";
    case "saved":
      return "Saved";
    case "error":
      return "Could not save settings";
    default:
      return project?.name;
  }
});

$effect(() => {
  untrack(() => {
    if (!settingsState.settingsDraft) void loadSettingsPanel();
  });
});

$effect(() => {
  if (settingsState.skillsProjectId === (skillsProjectId ?? null)) return;
  void loadSettingsSkills(skillsProjectId);
});
</script>

<MobileScreen
  title={page.label}
  subtitle={saveLabel}
  onBack={backFromMobileScreen}
  {backLabel}
>
  {#snippet actions()}
    <SettingsPageActions
      {page}
      {target}
      {controllers}
      settingsDraft={settingsState.settingsDraft}
      onSettingsChange={queueSettingsSave}
    />
  {/snippet}

  <div class="grid gap-4 px-3 py-3">
    <SettingsPageContent
      {page}
      {target}
      {controllers}
      {status}
      settingsDraft={settingsState.settingsDraft}
      applicationConfiguration={settingsState.applicationConfiguration}
      daemonCapability={settingsState.daemonCapability}
      daemonRestarting={settingsState.daemonRestarting}
      models={settingsState.models}
      authProviders={settingsState.authProviders}
      {project}
      skills={settingsState.skills}
      skillsLoading={settingsState.skillsLoading}
      skillsError={settingsState.skillsError}
      onSkillsRetry={() => loadSettingsSkills(skillsProjectId)}
      onSettingsChange={queueSettingsSave}
      onApplicationConfigurationChange={saveApplicationConfiguration}
      onRestartDaemon={restartOwnedDaemon}
      onColorThemeChange={setColorTheme}
      onColorModeChange={setColorMode}
    />
  </div>
</MobileScreen>
