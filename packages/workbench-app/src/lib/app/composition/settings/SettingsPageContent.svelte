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
  UpdateApplicationConfigurationRequest,
  UpdateSettingsRequest,
} from "$lib/api";
import type { SettingsPageDef } from "$lib/presentation/settings";
import { SettingsEmptyState } from "$lib/presentation/settings";
import UserCog from "@lucide/svelte/icons/user-cog";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import CompactionSettingsPage from "$lib/features/settings/views/pages/compaction/CompactionSettingsPage.svelte";
import ModelsSettingsPage from "$lib/features/settings/views/pages/models/ModelsSettingsPage.svelte";
import NotificationsSettingsPage from "$lib/features/settings/views/pages/notifications/NotificationsSettingsPage.svelte";
import PermissionsSettingsPage from "$lib/features/settings/views/pages/permissions/PermissionsSettingsPage.svelte";
import ProvidersSettingsPage from "$lib/features/settings/views/pages/providers/ProvidersSettingsPage.svelte";
import ShortcutsSettingsPage from "$lib/features/settings/views/pages/shortcuts/ShortcutsSettingsPage.svelte";
import SkillsSettingsPage from "$lib/features/settings/views/pages/skills/SkillsSettingsPage.svelte";
import StorageSettingsPage from "$lib/features/settings/views/pages/storage/StorageSettingsPage.svelte";
import SuggestionsSettingsPage from "./suggestions/SuggestionsSettingsPage.svelte";
import SystemSettingsPage from "$lib/features/settings/views/pages/system/SystemSettingsPage.svelte";
import ToolsSettingsPage from "$lib/features/settings/views/pages/tools/ToolsSettingsPage.svelte";
import TranscriptionSettingsPage from "$lib/features/settings/views/pages/transcription/TranscriptionSettingsPage.svelte";
import WorkbenchSettingsPage from "$lib/features/settings/views/pages/workbench/WorkbenchSettingsPage.svelte";
import ProjectToolsSettingsPage from "$lib/features/settings/views/pages/capabilities/ProjectToolsSettingsPage.svelte";
import type {
  SettingsPageControllers,
  SettingsScope,
} from "./settings-page-controllers.svelte";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

/**
 * The body of one settings page for the chosen scope. Rendered inside the
 * desktop settings shell and as a standalone phone settings screen.
 */
let {
  page,
  scope,
  onScopeChange,
  controllers,
  status,
  settingsDraft,
  applicationConfiguration,
  daemonCapability,
  daemonRestarting = false,
  models = [],
  authProviders = [],
  activeProject,
  skills = [],
  skillsLoading = false,
  skillsError,
  onSettingsChange,
  onApplicationConfigurationChange,
  onRestartDaemon,
  onColorThemeChange,
  onColorModeChange,
  onSkillsRetry,
}: {
  page: SettingsPageDef;
  scope: SettingsScope;
  onScopeChange: (scope: SettingsScope) => void;
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
  activeProject?: ProjectRecord;
  skills?: AvailableSkill[];
  skillsLoading?: boolean;
  skillsError?: string;
  onSettingsChange?: SettingsChange;
  onApplicationConfigurationChange?: (
    patch: UpdateApplicationConfigurationRequest,
  ) => void;
  onRestartDaemon?: () => void;
  onColorThemeChange?: (theme: ColorTheme) => void;
  onColorModeChange?: (colorMode: ColorMode) => void;
  onSkillsRetry?: () => void;
} = $props();
</script>

{#if settingsDraft}
  {#if scope === "project" && page.id === "tools"}
    <ProjectToolsSettingsPage
      configuration={controllers.capabilityConfiguration}
      {settingsDraft}
      loading={controllers.capabilityLoading}
      error={controllers.capabilityError}
      onPatch={(patch) => void controllers.patchProjectCapabilities(patch)}
      onReset={() => void controllers.resetProjectCapabilities()}
      onTrust={(trusted) => void controllers.setProjectCapabilityTrust(trusted)}
      onRetry={() => void controllers.loadProjectCapabilities()}
    />
  {:else if scope === "project" && page.id === "skills"}
    <SkillsSettingsPage
      scope="project"
      configuration={controllers.capabilityConfiguration}
      {settingsDraft}
      {skills}
      loading={controllers.capabilityLoading || skillsLoading}
      error={controllers.capabilityError ?? skillsError}
      onPatch={(patch) => void controllers.patchProjectCapabilities(patch)}
      onReset={() => void controllers.resetProjectCapabilities()}
      onTrust={(trusted) => void controllers.setProjectCapabilityTrust(trusted)}
      onRetry={() => {
        onSkillsRetry?.();
        void controllers.loadProjectCapabilities();
      }}
    />
  {:else if scope === "project" && page.id !== "permissions"}
    <SettingsEmptyState
      variant="card"
      icon={UserCog}
      title={`${page.label} is configured per user`}
      description={`${page.label} applies to every project on this machine.`}
    >
      {#snippet actions()}
        <Button
          size="xs"
          variant="outline"
          onclick={() => onScopeChange("user")}
        >
          Open user settings
        </Button>
      {/snippet}
    </SettingsEmptyState>
  {:else if page.id === "workbench"}
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
  {:else if page.id === "compaction"}
    <CompactionSettingsPage {settingsDraft} {onSettingsChange} />
  {:else if page.id === "suggestions"}
    <SuggestionsSettingsPage
      pageState={controllers.suggestionsPageState}
      {activeProject}
    />
  {:else if page.id === "models"}
    <ModelsSettingsPage
      {settingsDraft}
      {models}
      {authProviders}
      readComposerSelection={controllers.readComposerSelection}
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
      {scope}
      {settingsDraft}
      {activeProject}
      controller={controllers.permissionsPageState}
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
      scope="user"
      {settingsDraft}
      {skills}
      loading={skillsLoading}
      error={skillsError}
      onRetry={onSkillsRetry}
      {onSettingsChange}
    />
  {:else if page.id === "storage"}
    <StorageSettingsPage controller={controllers.storageController} />
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
