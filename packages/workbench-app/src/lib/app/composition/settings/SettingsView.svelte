<script lang="ts">
import type {
  ApplicationConfigurationSnapshot,
  AuthProviderMetadata,
  AvailableSkill,
  ColorMode,
  ColorTheme,
  ModelInfo,
  ProjectRecord,
  Settings,
  StatusResponse,
  ToolDescriptor,
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
} from "$lib/api";
import {
  SettingsShell,
  SettingsSidebarStatus,
} from "$lib/presentation/components/settings";
import { settingsPages } from "$lib/features/settings/registry/settings-pages";
import {
  skillSourceLabels,
  skillSourceSectionIds,
} from "$lib/features/settings/components/pages/skills/skills-filter";
import AgentsSettingsPage from "./agents/AgentsSettingsPage.svelte";
import ModelsPageActions from "$lib/features/settings/components/pages/models/ModelsPageActions.svelte";
import ModelsSettingsPage from "$lib/features/settings/components/pages/models/ModelsSettingsPage.svelte";
import { ModelsPageState } from "$lib/features/settings/components/pages/models/models-page-state.svelte";
import NotificationsSettingsPage from "$lib/features/settings/components/pages/notifications/NotificationsSettingsPage.svelte";
import PermissionsSettingsPage from "$lib/features/settings/components/pages/permissions/PermissionsSettingsPage.svelte";
import {
  getProjectPermissions,
  updateProjectPermissions,
} from "$lib/features/projects/api/projects.api";
import ProvidersSettingsPage from "$lib/features/settings/components/pages/providers/ProvidersSettingsPage.svelte";
import ShortcutsSettingsPage from "$lib/features/settings/components/pages/shortcuts/ShortcutsSettingsPage.svelte";
import SkillsSettingsPage from "$lib/features/settings/components/pages/skills/SkillsSettingsPage.svelte";
import StoragePageActions from "$lib/features/settings/components/pages/storage/StoragePageActions.svelte";
import StorageSettingsPage from "$lib/features/settings/components/pages/storage/StorageSettingsPage.svelte";
import { StoragePageController } from "$lib/features/settings/components/pages/storage/storage-page-state.svelte";
import SuggestionsPageActions from "./suggestions/SuggestionsPageActions.svelte";
import SuggestionsSettingsPage from "./suggestions/SuggestionsSettingsPage.svelte";
import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";
import SystemSettingsPage from "$lib/features/settings/components/pages/system/SystemSettingsPage.svelte";
import ToolsSettingsPage from "$lib/features/settings/components/pages/tools/ToolsSettingsPage.svelte";
import TranscriptionSettingsPage from "$lib/features/settings/components/pages/transcription/TranscriptionSettingsPage.svelte";
import WorkbenchSettingsPage from "$lib/features/settings/components/pages/workbench/WorkbenchSettingsPage.svelte";

type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

type Props = {
  status?: StatusResponse;
  settingsDraft?: Settings;
  applicationConfiguration?: ApplicationConfigurationSnapshot;
  daemonCapability?: {
    mode?: "local" | "remote";
    owned: boolean;
    canRestart: boolean;
  };
  daemonRestarting?: boolean;
  activePageId?: string;
  activeSectionId?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  toolDescriptors?: ToolDescriptor[];
  toolDescriptorsLoading?: boolean;
  activeProject?: ProjectRecord;
  agentBrowserSkills?: AvailableSkill[];
  globalSkills?: AvailableSkill[];
  projectSkills?: AvailableSkill[];
  skillsLoading?: boolean;
  skillsError?: string;
  settingsSaveStatus?: SettingsSaveStatus;
  settingsMessage?: string;
  onSettingsChange?: SettingsChange;
  onApplicationConfigurationChange?: (
    patch: UpdateApplicationConfigurationRequest,
  ) => void;
  onRestartDaemon?: () => void;
  onColorThemeChange?: (theme: ColorTheme) => void;
  onColorModeChange?: (colorMode: ColorMode) => void;
  onSkillsRetry?: () => void;
};

let {
  status,
  settingsDraft = $bindable<Settings | undefined>(),
  applicationConfiguration,
  daemonCapability,
  daemonRestarting = false,
  activePageId = $bindable("workbench"),
  activeSectionId = $bindable("appearance"),
  models = [],
  authProviders = [],
  toolDescriptors = [],
  toolDescriptorsLoading = false,
  activeProject,
  agentBrowserSkills = [],
  globalSkills = [],
  projectSkills = [],
  skillsLoading = false,
  skillsError,
  settingsSaveStatus = "idle",
  settingsMessage,
  onSettingsChange,
  onApplicationConfigurationChange,
  onRestartDaemon,
  onColorThemeChange,
  onColorModeChange,
  onSkillsRetry,
}: Props = $props();

/** Skills sections mirror the sources that actually have skills. */
const skillSections = $derived(
  (
    [
      ["agentBrowser", agentBrowserSkills],
      ["global", globalSkills],
      ["project", projectSkills],
    ] as const
  )
    .filter(([, skills]) => skills.length > 0)
    .map(([source]) => ({
      id: skillSourceSectionIds[source],
      label: skillSourceLabels[source],
    })),
);

const pages = $derived(
  settingsPages.map((page) =>
    page.id === "skills" && skillSections.length > 0
      ? { ...page, sections: skillSections }
      : page,
  ),
);

const modelsPageState = new ModelsPageState();
const suggestionsPageState = new SuggestionsPageState();
const storageController = new StoragePageController();

function statusText(): string {
  if (settingsMessage) return settingsMessage;
  if (settingsSaveStatus === "saving") return "Saving…";
  if (settingsSaveStatus === "dirty") return "Unsaved changes";
  if (settingsSaveStatus === "saved") return "Saved";
  if (settingsSaveStatus === "error") return "Could not save settings";
  return "Auto save enabled";
}
</script>

<SettingsShell
  {pages}
  bind:activePageId
  bind:activeSectionId
  title="Settings"
  ariaLabel="Settings pages"
  showHeader={!!settingsDraft}
>
  {#snippet sidebarFooter()}
    <SettingsSidebarStatus status={settingsSaveStatus} text={statusText()} />
  {/snippet}

  {#snippet pageActions(page)}
    {#if settingsDraft}
      {#if page.id === "models"}
        <ModelsPageActions
          pageState={modelsPageState}
          {settingsDraft}
          {models}
          {authProviders}
          {onSettingsChange}
        />
      {:else if page.id === "suggestions"}
        <SuggestionsPageActions pageState={suggestionsPageState} />
      {:else if page.id === "storage"}
        <StoragePageActions controller={storageController} />
      {/if}
    {/if}
  {/snippet}

  {#snippet children(page)}
    {#if settingsDraft}
      {#if page.id === "workbench"}
        <WorkbenchSettingsPage
          {settingsDraft}
          {onColorThemeChange}
          {onColorModeChange}
          {onSettingsChange}
        />
      {:else if page.id === "notifications"}
        <NotificationsSettingsPage {settingsDraft} {onSettingsChange} />
      {:else if page.id === "transcription"}
        <TranscriptionSettingsPage {settingsDraft} {onSettingsChange} />
      {:else if page.id === "shortcuts"}
        <ShortcutsSettingsPage />
      {:else if page.id === "agents"}
        <AgentsSettingsPage
          {settingsDraft}
          {models}
          {authProviders}
          {onSettingsChange}
        />
      {:else if page.id === "suggestions"}
        <SuggestionsSettingsPage
          pageState={suggestionsPageState}
          {activeProject}
        />
      {:else if page.id === "models"}
        <ModelsSettingsPage
          pageState={modelsPageState}
          {settingsDraft}
          {models}
          {authProviders}
          {onSettingsChange}
        />
      {:else if page.id === "providers"}
        <ProvidersSettingsPage
          {settingsDraft}
          {models}
          {authProviders}
          {onSettingsChange}
        />
      {:else if page.id === "permissions"}
        <PermissionsSettingsPage
          {settingsDraft}
          {toolDescriptors}
          {toolDescriptorsLoading}
          {activeProject}
          {getProjectPermissions}
          {updateProjectPermissions}
          {onSettingsChange}
        />
      {:else if page.id === "tools"}
        <ToolsSettingsPage
          {settingsDraft}
          {status}
          {authProviders}
          {models}
          {onSettingsChange}
        />
      {:else if page.id === "skills"}
        <SkillsSettingsPage
          {settingsDraft}
          {agentBrowserSkills}
          {globalSkills}
          {projectSkills}
          loading={skillsLoading}
          error={skillsError}
          onRetry={onSkillsRetry}
          {onSettingsChange}
        />
      {:else if page.id === "storage"}
        <StorageSettingsPage controller={storageController} />
      {:else if page.id === "system"}
        <SystemSettingsPage
          configuration={applicationConfiguration}
          {status}
          {daemonCapability}
          {daemonRestarting}
          onConfigurationChange={onApplicationConfigurationChange}
          {onRestartDaemon}
        />
      {/if}
    {:else}
      <div class="grid gap-1 py-12 text-center">
        <strong class="text-sm text-foreground">Settings are loading</strong>
        <span class="text-xs text-muted-foreground"
          >Fetching the current configuration from the daemon.</span
        >
      </div>
    {/if}
  {/snippet}
</SettingsShell>
