<script lang="ts">
import TitlesSettingsPage from "$lib/features/settings/views/pages/titles/TitlesSettingsPage.svelte";
import ToolsSettingsPage from "$lib/features/settings/views/pages/tools/ToolsSettingsPage.svelte";
import SkillsSettingsPage from "$lib/features/settings/views/pages/skills/SkillsSettingsPage.svelte";
import ProfilesSettingsPage from "$lib/features/settings/views/pages/agent-profiles/ProfilesSettingsPage.svelte";
import { profileKindForPage } from "$lib/features/settings/views/pages/agent-profiles/profile-kind";
import type {
  ApplicationConfigurationSnapshot,
  AuthProviderMetadata,
  AvailableSkill,
  ColorMode,
  ColorTheme,
  ModelInfo,
  Settings,
  StatusResponse,
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
} from "$lib/api";
import { projectView } from "$lib/features/conversations/adapters/core-context.adapter";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import SuggestionsSettingsPage from "./suggestions/SuggestionsSettingsPage.svelte";
import type { Project } from "@nervekit/contracts/core";
import type { SettingsPageDef } from "$lib/presentation/settings";
import { SettingsEmptyState } from "$lib/presentation/settings";
import GeneralSettingsPage from "$lib/features/settings/views/pages/general/GeneralSettingsPage.svelte";
import ModelsSettingsPage from "$lib/features/settings/views/pages/models/ModelsSettingsPage.svelte";
import NotificationsSettingsPage from "$lib/features/settings/views/pages/notifications/NotificationsSettingsPage.svelte";
import PermissionsSettingsPage from "$lib/features/settings/views/pages/permissions/PermissionsSettingsPage.svelte";
import ProvidersSettingsPage from "$lib/features/settings/views/pages/providers/ProvidersSettingsPage.svelte";
import ShortcutsSettingsPage from "$lib/features/settings/views/pages/shortcuts/ShortcutsSettingsPage.svelte";
import StorageSettingsPage from "$lib/features/settings/views/pages/storage/StorageSettingsPage.svelte";
import SystemSettingsPage from "$lib/features/settings/views/pages/system/SystemSettingsPage.svelte";
import VoiceSettingsPage from "$lib/features/settings/views/pages/voice/VoiceSettingsPage.svelte";
import IntegrationsSettingsPage from "$lib/features/settings/views/pages/integrations/IntegrationsSettingsPage.svelte";
import InstructionsFilesPage from "$lib/features/settings/views/pages/project/InstructionsFilesPage.svelte";
import LaunchSettingsPage from "$lib/features/settings/views/pages/project/LaunchSettingsPage.svelte";
import TrustSettingsPage from "$lib/features/settings/views/pages/project/TrustSettingsPage.svelte";
import WorkbenchSettingsPage from "$lib/features/settings/views/pages/workbench/WorkbenchSettingsPage.svelte";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import type { SettingsPageControllers } from "./settings-page-controllers.svelte";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

/**
 * The body of one settings page for the given scope target. Rendered inside the
 * desktop settings shell and as a standalone phone settings screen.
 */
let {
  page,
  target,
  controllers,
  status,
  settingsDraft,
  applicationConfiguration,
  daemonCapability,
  daemonRestarting = false,
  models = [],
  authProviders = [],
  project,
  skills = [],
  skillsLoading = false,
  skillsError,
  onSettingsChange,
  onApplicationConfigurationChange,
  onRestartDaemon,
  lightTheme,
  darkTheme,
  colorMode,
  onLightThemeChange,
  onDarkThemeChange,
  onColorModeChange,
}: {
  page: SettingsPageDef;
  /** Fixed for the lifetime of the view; every save goes to this target. */
  target: SettingsScopeTarget;
  controllers: SettingsPageControllers;
  status?: StatusResponse;
  settingsDraft?: Settings;
  applicationConfiguration?: ApplicationConfigurationSnapshot;
  daemonCapability?: {
    mode?: "local" | "remote";
    owned: boolean;
    canRestart: boolean;
  };
  daemonRestarting?: boolean;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  project?: Project;
  skills?: AvailableSkill[];
  skillsLoading?: boolean;
  skillsError?: string;
  onSettingsChange?: SettingsChange;
  onApplicationConfigurationChange?: (
    patch: UpdateApplicationConfigurationRequest,
  ) => void;
  onRestartDaemon?: () => void;
  lightTheme: ColorTheme;
  darkTheme: ColorTheme;
  colorMode: ColorMode;
  onLightThemeChange?: (theme: ColorTheme) => void;
  onDarkThemeChange?: (theme: ColorTheme) => void;
  onColorModeChange?: (colorMode: ColorMode) => void;
  onSkillsRetry?: () => void;
} = $props();

const scope = $derived(target.kind);
const projectId = $derived(
  target.kind === "project" ? target.projectId : undefined,
);
</script>

{#if settingsDraft}
  {#if page.id === "agents" || page.id === "sub-agents"}
    <ProfilesSettingsPage
      kind={profileKindForPage(page.id)}
      onOpenFile={project
        ? (path) => void openFilePane({ projectId: project.id, path })
        : undefined}
      {settingsDraft}
      {models}
      {authProviders}
      {skills}
      {scope}
      {projectId}
    />
  {:else if page.id === "permission-rules"}
    <PermissionsSettingsPage
      {scope}
      {settingsDraft}
      controller={controllers.permissionsController}
      {projectId}
      projectName={project?.name}
    />
  {:else if page.id === "workbench"}
    <WorkbenchSettingsPage
      {settingsDraft}
      {lightTheme}
      {darkTheme}
      {colorMode}
      {onLightThemeChange}
      {onDarkThemeChange}
      {onColorModeChange}
      {onSettingsChange}
    />
  {:else if page.id === "notifications"}
    <NotificationsSettingsPage {settingsDraft} {onSettingsChange} />
  {:else if page.id === "titles"}
    <TitlesSettingsPage
      {settingsDraft}
      {onSettingsChange}
      {models}
      {authProviders}
    />
  {:else if page.id === "voice"}
    <VoiceSettingsPage {settingsDraft} {onSettingsChange} />
  {:else if page.id === "shortcuts"}
    <ShortcutsSettingsPage />
  {:else if page.id === "general"}
    <GeneralSettingsPage {scope} {projectId} {models} {authProviders} />
  {:else if page.id === "suggestions"}
    <SuggestionsSettingsPage
      pageState={controllers.suggestionsPageState}
      activeProject={project ? projectView(project) : undefined}
    />
  {:else if page.id === "models"}
    <ModelsSettingsPage {models} {authProviders} />
  {:else if page.id === "integrations"}
    <IntegrationsSettingsPage
      {settingsDraft}
      {authProviders}
      {onSettingsChange}
    />
  {:else if page.id === "launch"}
    <LaunchSettingsPage
      definitions={controllers.launchDefinitions()}
      onDelete={(id) => void controllers.deleteProjectLaunch(id)}
    />
  {:else if page.id === "instructions-files"}
    <InstructionsFilesPage
      files={controllers.instructionsFiles}
      loading={controllers.instructionsLoading}
      onOpen={project
        ? (path) => void openFilePane({ projectId: project.id, path })
        : undefined}
    />
  {:else if page.id === "trust"}
    <TrustSettingsPage {projectId} entries={controllers.trustEntries()} />
  {:else if page.id === "providers"}
    <ProvidersSettingsPage {models} {authProviders} />
  {:else if page.id === "tools"}
    <ToolsSettingsPage
      {scope}
      {projectId}
      {settingsDraft}
      {models}
      {authProviders}
      {status}
    />
  {:else if page.id === "skills"}
    <SkillsSettingsPage
      {scope}
      {projectId}
      {skills}
      loading={skillsLoading}
      error={skillsError}
    />
  {:else if page.id === "storage"}
    <StorageSettingsPage controller={controllers.storageController} />
  {:else if scope === "user" && page.id === "system"}
    <SystemSettingsPage
      configuration={applicationConfiguration}
      {status}
      {daemonCapability}
      {daemonRestarting}
      onConfigurationChange={onApplicationConfigurationChange}
      {onRestartDaemon}
    />
  {:else}
    <SettingsEmptyState
      variant="card"
      icon={page.icon}
      title={page.label}
      description="This page is being rebuilt."
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
