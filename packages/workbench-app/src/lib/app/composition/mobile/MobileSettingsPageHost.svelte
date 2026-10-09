<script lang="ts">
import { untrack } from "svelte";
import { MobileScreen } from "$lib/presentation/shell";
import { settingsPages } from "$lib/features/settings/registry/settings-pages";
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
import {
  PROJECT_SCOPED_SETTINGS_PAGES,
  mobileSettingsScope,
} from "./mobile-settings-scope.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/**
 * One settings page as a phone screen. The body is the desktop page component;
 * only the navigation around it (sidebar, section links) is phone-native.
 */
let { route }: MobileScreenProps<"settings-page"> = $props();

const page = $derived(
  settingsPages.find((candidate) => candidate.id === route.pageId),
);
const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const scope = $derived(
  activeProject && PROJECT_SCOPED_SETTINGS_PAGES.includes(route.pageId)
    ? mobileSettingsScope.current
    : "user",
);
const controllers = createSettingsPageControllers();
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
      return scope === "project" ? activeProject?.name : undefined;
  }
});

$effect(() => {
  untrack(() => {
    if (!settingsState.settingsDraft) void loadSettingsPanel();
  });
});

$effect(() => {
  const projectId = activeProject?.id;
  if (settingsState.skillsProjectId === (projectId ?? null)) return;
  void loadSettingsSkills(projectId);
});
</script>

<MobileScreen
  title={page?.label ?? "Settings"}
  subtitle={saveLabel}
  onBack={backFromMobileScreen}
  backLabel="Back to settings"
>
  {#snippet actions()}
    {#if page}
      <SettingsPageActions
        {page}
        {controllers}
        settingsDraft={settingsState.settingsDraft}
        onSettingsChange={queueSettingsSave}
      />
    {/if}
  {/snippet}

  {#if page}
    <div class="grid gap-4 px-3 py-3">
      <SettingsPageContent
        {page}
        {scope}
        onScopeChange={(next) => (mobileSettingsScope.current = next)}
        {controllers}
        {status}
        settingsDraft={settingsState.settingsDraft}
        applicationConfiguration={settingsState.applicationConfiguration}
        daemonCapability={settingsState.daemonCapability}
        daemonRestarting={settingsState.daemonRestarting}
        models={settingsState.models}
        authProviders={settingsState.authProviders}
        {activeProject}
        skills={settingsState.skills}
        skillsLoading={settingsState.skillsLoading}
        skillsError={settingsState.skillsError}
        onSkillsRetry={() => loadSettingsSkills(activeProject?.id)}
        onSettingsChange={queueSettingsSave}
        onApplicationConfigurationChange={saveApplicationConfiguration}
        onRestartDaemon={restartOwnedDaemon}
        onColorThemeChange={setColorTheme}
        onColorModeChange={setColorMode}
      />
    </div>
  {:else}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      This settings page does not exist.
    </p>
  {/if}
</MobileScreen>
