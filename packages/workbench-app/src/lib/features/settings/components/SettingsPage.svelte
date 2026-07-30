<script lang="ts">
import type {
  AuthProviderMetadata,
  AvailableSkill,
  ModelInfo,
  ProjectRecord,
  Settings,
  StatusResponse,
  UpdateSettingsRequest,
} from "$lib/api";
import type { ThemePreference } from "$lib/app/shell/appearance.svelte";
import {
  SettingsShell,
  SettingsSidebarStatus,
} from "$lib/presentation/components/settings";
import { settingsPages } from "$lib/features/settings/registry/settings-pages";
import AgentsSettingsPage from "./pages/agents/AgentsSettingsPage.svelte";
import ModelsPageActions from "./pages/models/ModelsPageActions.svelte";
import ModelsSettingsPage from "./pages/models/ModelsSettingsPage.svelte";
import { ModelsPageState } from "./pages/models/models-page-state.svelte";
import NotificationsSettingsPage from "./pages/notifications/NotificationsSettingsPage.svelte";
import ShortcutsSettingsPage from "./pages/shortcuts/ShortcutsSettingsPage.svelte";
import SkillsSettingsPage from "./pages/skills/SkillsSettingsPage.svelte";
import StoragePageActions from "./pages/storage/StoragePageActions.svelte";
import StorageSettingsPage from "./pages/storage/StorageSettingsPage.svelte";
import { StoragePageController } from "./pages/storage/storage-page-state.svelte";
import SuggestionsPageActions from "./pages/suggestions/SuggestionsPageActions.svelte";
import SuggestionsSettingsPage from "./pages/suggestions/SuggestionsSettingsPage.svelte";
import { SuggestionsPageState } from "./pages/suggestions/suggestions-page-state.svelte";
import SystemSettingsPage from "./pages/system/SystemSettingsPage.svelte";
import ToolsSettingsPage from "./pages/tools/ToolsSettingsPage.svelte";
import WorkbenchSettingsPage from "./pages/workbench/WorkbenchSettingsPage.svelte";

type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

type Props = {
  status?: StatusResponse;
  settingsDraft?: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  activeProject?: ProjectRecord;
  agentBrowserSkills?: AvailableSkill[];
  globalSkills?: AvailableSkill[];
  projectSkills?: AvailableSkill[];
  skillsLoading?: boolean;
  skillsError?: string;
  settingsSaveStatus?: SettingsSaveStatus;
  settingsMessage?: string;
  onSettingsChange?: SettingsChange;
  onThemeChange?: (theme: ThemePreference) => void;
  onSkillsRetry?: () => void;
};

let {
  status,
  settingsDraft = $bindable<Settings | undefined>(),
  models = [],
  authProviders = [],
  activeProject,
  agentBrowserSkills = [],
  globalSkills = [],
  projectSkills = [],
  skillsLoading = false,
  skillsError,
  settingsSaveStatus = "idle",
  settingsMessage,
  onSettingsChange,
  onThemeChange,
  onSkillsRetry,
}: Props = $props();

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
  pages={settingsPages}
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

  {#snippet children(page, activeTabId)}
    {#if settingsDraft}
      {#if page.id === "workbench"}
        <WorkbenchSettingsPage
          {activeTabId}
          {settingsDraft}
          {onThemeChange}
          {onSettingsChange}
        />
      {:else if page.id === "notifications"}
        <NotificationsSettingsPage
          {activeTabId}
          {settingsDraft}
          {onSettingsChange}
        />
      {:else if page.id === "shortcuts"}
        <ShortcutsSettingsPage />
      {:else if page.id === "agents"}
        <AgentsSettingsPage
          {activeTabId}
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
      {:else if page.id === "tools"}
        <ToolsSettingsPage
          {activeTabId}
          {settingsDraft}
          {status}
          {authProviders}
          {onSettingsChange}
        />
      {:else if page.id === "skills"}
        <SkillsSettingsPage
          {settingsDraft}
          {activeProject}
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
          {activeTabId}
          {settingsDraft}
          {status}
          {onSettingsChange}
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
