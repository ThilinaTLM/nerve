<script lang="ts">
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
import type { Project } from "@nervekit/contracts/core";
import {
  SettingsShell,
  SettingsSidebarStatus,
} from "$lib/presentation/settings";
import { settingsPages } from "$lib/features/settings/registry/settings-pages";
import {
  skillSourceLabels,
  skillSourceSectionIds,
  sourcesForScope,
} from "$lib/domain/skills/skill-catalog";
import SettingsPageActions from "./SettingsPageActions.svelte";
import SettingsPageContent from "./SettingsPageContent.svelte";
import {
  createSettingsPageControllers,
  type SettingsScope,
} from "./settings-page-controllers.svelte";

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
  activeProject?: Project;
  skills?: AvailableSkill[];
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
  skills = [],
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

let settingsScope = $state<SettingsScope>("user");
const controllers = createSettingsPageControllers({
  activeProject: () => activeProject,
  scope: () => settingsScope,
});

/** Skills sections mirror the sources the current scope actually renders. */
const skillSections = $derived(
  sourcesForScope(settingsScope)
    .filter((source) => skills.some((skill) => skill.source === source))
    .map((source) => ({
      id: skillSourceSectionIds[source],
      label: skillSourceLabels[source],
    })),
);

/** Pages that hold project-scoped controls; the rest stay user-only. */
const projectScopedPageIds = new Set(["tools", "skills", "permissions"]);

/** The Skills page states what the current scope writes, instead of a banner. */
const skillsDescription = $derived(
  settingsScope === "user"
    ? "Your defaults for every project. Projects and conversations can override them."
    : `Overrides for ${activeProject?.name ?? "this project"}. Skills without an override follow your user settings.`,
);

const pages = $derived(
  settingsPages.map((page) => {
    const sections =
      page.id === "skills" && skillSections.length > 0
        ? skillSections
        : page.sections;
    if (page.id === "skills")
      return { ...page, sections, description: skillsDescription };
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
    <SettingsPageActions
      {page}
      {controllers}
      {settingsDraft}
      {onSettingsChange}
    />
  {/snippet}

  {#snippet children(page)}
    <SettingsPageContent
      {page}
      scope={settingsScope}
      onScopeChange={(scope) => (settingsScope = scope)}
      {controllers}
      {status}
      {settingsDraft}
      {applicationConfiguration}
      {daemonCapability}
      {daemonRestarting}
      {models}
      {authProviders}
      {activeProject}
      {skills}
      {skillsLoading}
      {skillsError}
      {onSettingsChange}
      {onApplicationConfigurationChange}
      {onRestartDaemon}
      {onColorThemeChange}
      {onColorModeChange}
      {onSkillsRetry}
    />
  {/snippet}
</SettingsShell>
