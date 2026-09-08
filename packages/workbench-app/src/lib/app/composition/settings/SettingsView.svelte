<script lang="ts">
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
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
import {
  SettingsShell,
  SettingsSidebarStatus,
} from "$lib/presentation/settings";
import { settingsPages } from "$lib/features/settings/registry/settings-pages";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { parseModelKey } from "$lib/presentation/utils/model";
import {
  skillSourceLabels,
  skillSourceSectionIds,
} from "$lib/features/settings/views/pages/skills/skills-filter";
import CompactionSettingsPage from "$lib/features/settings/views/pages/compaction/CompactionSettingsPage.svelte";
import ModelsPageActions from "$lib/features/settings/views/pages/models/ModelsPageActions.svelte";
import ModelsSettingsPage from "$lib/features/settings/views/pages/models/ModelsSettingsPage.svelte";
import { ModelsPageState } from "$lib/features/settings/views/pages/models/models-page-state.svelte";
import NotificationsSettingsPage from "$lib/features/settings/views/pages/notifications/NotificationsSettingsPage.svelte";
import PermissionsSettingsPage from "$lib/features/settings/views/pages/permissions/PermissionsSettingsPage.svelte";
import { PermissionsPageState } from "$lib/features/settings/views/pages/permissions/permissions-page-state.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  getPermissionPolicyConfiguration,
  updatePermissionOverlay,
  updateProjectPermissionTrust,
  getCapabilityConfiguration,
  updateCapabilities,
  updateCapabilityTrust,
} from "$lib/features/projects/api/projects.api";
import ProvidersSettingsPage from "$lib/features/settings/views/pages/providers/ProvidersSettingsPage.svelte";
import ShortcutsSettingsPage from "$lib/features/settings/views/pages/shortcuts/ShortcutsSettingsPage.svelte";
import SkillsSettingsPage from "$lib/features/settings/views/pages/skills/SkillsSettingsPage.svelte";
import StoragePageActions from "$lib/features/settings/views/pages/storage/StoragePageActions.svelte";
import StorageSettingsPage from "$lib/features/settings/views/pages/storage/StorageSettingsPage.svelte";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
import SuggestionsPageActions from "./suggestions/SuggestionsPageActions.svelte";
import SuggestionsSettingsPage from "./suggestions/SuggestionsSettingsPage.svelte";
import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";
import SystemSettingsPage from "$lib/features/settings/views/pages/system/SystemSettingsPage.svelte";
import ToolsSettingsPage from "$lib/features/settings/views/pages/tools/ToolsSettingsPage.svelte";
import TranscriptionSettingsPage from "$lib/features/settings/views/pages/transcription/TranscriptionSettingsPage.svelte";
import WorkbenchSettingsPage from "$lib/features/settings/views/pages/workbench/WorkbenchSettingsPage.svelte";
import ProjectSkillsSettingsPage from "$lib/features/settings/views/pages/capabilities/ProjectSkillsSettingsPage.svelte";
import ProjectToolsSettingsPage from "$lib/features/settings/views/pages/capabilities/ProjectToolsSettingsPage.svelte";
import { SettingsEmptyState } from "$lib/presentation/settings";
import UserCog from "@lucide/svelte/icons/user-cog";
import { Button } from "@nervekit/ui-kit/components/ui/button";

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

let settingsScope = $state<"user" | "project">("user");
let capabilityConfiguration = $state<CapabilityConfiguration>();
let capabilityLoading = $state(false);
let capabilityError = $state<string>();
let capabilityRequest = 0;

async function loadProjectCapabilities(): Promise<void> {
  const projectId = activeProject?.id;
  const request = ++capabilityRequest;
  capabilityConfiguration = undefined;
  capabilityError = undefined;
  if (!projectId) return;
  capabilityLoading = true;
  try {
    const configuration = await getCapabilityConfiguration(projectId);
    if (request === capabilityRequest) capabilityConfiguration = configuration;
  } catch (error) {
    if (request === capabilityRequest)
      capabilityError = error instanceof Error ? error.message : String(error);
  } finally {
    if (request === capabilityRequest) capabilityLoading = false;
  }
}

$effect(() => {
  const projectId = activeProject?.id;
  const scope = settingsScope;
  if (scope === "project" && projectId) void loadProjectCapabilities();
});

/** Mutations reload on failure, so the message is re-applied afterwards. */
async function runCapabilityMutation(
  mutation: () => Promise<CapabilityConfiguration | void>,
): Promise<void> {
  try {
    const configuration = await mutation();
    if (configuration) capabilityConfiguration = configuration;
    else await loadProjectCapabilities();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await loadProjectCapabilities();
    capabilityError = message;
  }
}

async function patchProjectCapabilities(patch: CapabilityPatch): Promise<void> {
  const project = activeProject;
  const current = capabilityConfiguration;
  if (!project || !current) return;
  await runCapabilityMutation(() =>
    updateCapabilities({
      projectId: project.id,
      origin: "project",
      patch,
      expectedDigest: current.projectDigest,
    }),
  );
}

async function resetProjectCapabilities(): Promise<void> {
  const project = activeProject;
  const current = capabilityConfiguration;
  if (!project || !current) return;
  await runCapabilityMutation(() =>
    updateCapabilities({
      projectId: project.id,
      origin: "project",
      replace: {
        schemaVersion: 1,
        tools: {},
        skills: { file: {}, agentBrowser: {} },
      },
      expectedDigest: current.projectDigest,
    }),
  );
}

async function setProjectCapabilityTrust(trusted: boolean): Promise<void> {
  const project = activeProject;
  const current = capabilityConfiguration;
  if (!project || !current) return;
  await runCapabilityMutation(async () => {
    await updateCapabilityTrust(project.id, trusted, current.projectDigest);
  });
}

const permissionsPageState = new PermissionsPageState({
  getConfiguration: getPermissionPolicyConfiguration,
  updateOverlay: updatePermissionOverlay,
  updateTrust: async (projectId, trusted) => {
    await updateProjectPermissionTrust(projectId, trusted);
  },
  onConfigurationLoaded: (projectId, configuration) => {
    permissionRuleSetCatalog.install(projectId, configuration.ruleSets);
  },
});

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

/** Pages that hold project-scoped controls; the rest stay user-only. */
const projectScopedPageIds = new Set(["tools", "skills", "permissions"]);

const pages = $derived(
  settingsPages.map((page) => {
    const sections =
      page.id === "skills" && skillSections.length > 0
        ? skillSections
        : page.sections;
    if (settingsScope === "user") return { ...page, sections };
    if (page.id === "permissions")
      return {
        ...page,
        sections: sections.filter((section) => section.id === "overlays"),
      };
    if (!projectScopedPageIds.has(page.id)) return { ...page, sections: [] };
    return { ...page, sections };
  }),
);

const modelsPageState = new ModelsPageState();
const suggestionsPageState = new SuggestionsPageState();
const storageController = new StoragePageController();

/** The composer's live selection is what "remember my last selection" saves. */
function readComposerSelection(): Settings["lastAgentSelection"] {
  const model = parseModelKey(conversationState.selectedModelKey);
  return {
    mode: conversationState.selectedMode,
    permissionLevel: conversationState.selectedPermissionLevel,
    permissionRuleSetId: conversationState.selectedPermissionRuleSetId,
    ...(model ? { model } : {}),
    thinkingLevel: conversationState.selectedThinkingLevel,
  };
}

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
  scope={settingsScope}
  projectScopeLabel={activeProject?.name ?? "Project"}
  projectScopeDisabled={!activeProject}
  onScopeChange={(scope) => (settingsScope = scope)}
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
      {#if settingsScope === "project" && page.id === "tools"}
        <ProjectToolsSettingsPage
          configuration={capabilityConfiguration}
          {settingsDraft}
          loading={capabilityLoading}
          error={capabilityError}
          onPatch={(patch) => void patchProjectCapabilities(patch)}
          onReset={() => void resetProjectCapabilities()}
          onTrust={(trusted) => void setProjectCapabilityTrust(trusted)}
          onRetry={() => void loadProjectCapabilities()}
        />
      {:else if settingsScope === "project" && page.id === "skills"}
        <ProjectSkillsSettingsPage
          configuration={capabilityConfiguration}
          {settingsDraft}
          {agentBrowserSkills}
          {globalSkills}
          {projectSkills}
          loading={capabilityLoading || skillsLoading}
          error={capabilityError ?? skillsError}
          onPatch={(patch) => void patchProjectCapabilities(patch)}
          onReset={() => void resetProjectCapabilities()}
          onTrust={(trusted) => void setProjectCapabilityTrust(trusted)}
          onRetry={() => {
            onSkillsRetry?.();
            void loadProjectCapabilities();
          }}
        />
      {:else if settingsScope === "project" && page.id !== "permissions"}
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
              onclick={() => (settingsScope = "user")}
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
          pageState={suggestionsPageState}
          {activeProject}
        />
      {:else if page.id === "models"}
        <ModelsSettingsPage
          pageState={modelsPageState}
          {settingsDraft}
          {models}
          {authProviders}
          {readComposerSelection}
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
          scope={settingsScope}
          {settingsDraft}
          {activeProject}
          controller={permissionsPageState}
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
