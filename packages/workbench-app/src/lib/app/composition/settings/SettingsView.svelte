<script lang="ts">
import type {
  ApplicationConfigurationSnapshot,
  AuthProviderMetadata,
  AvailableSkill,
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
import {
  resolveSettingsPageId,
  settingsNavFor,
  settingsPagesFor,
  settingsScopeHeader,
} from "$lib/features/settings/registry/settings-pages";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import {
  skillSourceLabels,
  skillSourceSectionIds,
  sourcesForScope,
} from "$lib/domain/skills/skill-catalog";
import SettingsPageActions from "./SettingsPageActions.svelte";
import SettingsPageContent from "./SettingsPageContent.svelte";
import { createSettingsPageControllers } from "./settings-page-controllers.svelte";

type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

type Props = {
  /** What this view edits; fixed for the life of the view. */
  target: SettingsScopeTarget;
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
  /** The project of a project target. */
  project?: Project;
  /** Shortcut from user settings to the currently active project. */
  projectSettingsAction?: { name: string; onOpen: () => void };
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
  theme: ColorTheme;
  onThemeChange?: (theme: ColorTheme) => void;
  onSkillsRetry?: () => void;
};

let {
  target,
  status,
  settingsDraft = $bindable<Settings | undefined>(),
  applicationConfiguration,
  daemonCapability,
  daemonRestarting = false,
  activePageId = $bindable(),
  activeSectionId = $bindable(),
  models = [],
  authProviders = [],
  project,
  projectSettingsAction,
  skills = [],
  skillsLoading = false,
  skillsError,
  settingsSaveStatus = "idle",
  settingsMessage,
  onSettingsChange,
  onApplicationConfigurationChange,
  onRestartDaemon,
  theme,
  onThemeChange,
  onSkillsRetry,
}: Props = $props();

const controllers = createSettingsPageControllers({
  target: () => target,
  project: () => project,
});

/** Skills sections mirror the sources the scope actually renders. */
const skillSections = $derived(
  sourcesForScope(target.kind)
    .filter((source) => skills.some((skill) => skill.source === source))
    .map((source) => ({
      id: skillSourceSectionIds[source],
      label: skillSourceLabels[source],
    })),
);

/** The Skills page states what the scope writes, instead of a banner. */
const skillsDescription = $derived(
  target.kind === "user"
    ? "Your defaults for every project. Projects and conversations can override them."
    : `Overrides for ${project?.name ?? "this project"}. Skills without an override follow your user settings.`,
);

const pages = $derived(
  settingsPagesFor(target).map((page) =>
    page.id === "skills"
      ? {
          ...page,
          sections: skillSections.length > 0 ? skillSections : page.sections,
          description: skillsDescription,
        }
      : page,
  ),
);

/** Project pages that differ from the user's settings are marked with their count. */
const badges = $derived(
  Object.fromEntries(
    Object.entries(target.kind === "project" ? controllers.pageDiffs() : {})
      .filter(([, count]) => count > 0)
      .map(([id, count]) => [
        id,
        { text: String(count), tone: "info" as const },
      ]),
  ),
);
const groups = $derived(settingsNavFor(target, badges));
const scopeHeader = $derived({
  ...settingsScopeHeader(target, project),
  ...(target.kind === "user" && projectSettingsAction
    ? {
        action: {
          label: "Project settings",
          title: `Open settings for ${projectSettingsAction.name}`,
          onSelect: projectSettingsAction.onOpen,
        },
      }
    : {}),
});

// Stale ids (restored state, old links) land on the scope's default page.
$effect(() => {
  const resolved = resolveSettingsPageId(target.kind, activePageId);
  if (resolved !== activePageId) activePageId = resolved;
});

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
  {groups}
  {scopeHeader}
  bind:activePageId
  bind:activeSectionId
  ariaLabel="Settings pages"
  showHeader={!!settingsDraft}
>
  {#snippet sidebarFooter()}
    <SettingsSidebarStatus status={settingsSaveStatus} text={statusText()} />
  {/snippet}

  {#snippet pageActions(page)}
    <SettingsPageActions
      {page}
      {target}
      {controllers}
      {settingsDraft}
      {onSettingsChange}
    />
  {/snippet}

  {#snippet children(page)}
    <SettingsPageContent
      {page}
      {target}
      {controllers}
      {status}
      {settingsDraft}
      {applicationConfiguration}
      {daemonCapability}
      {daemonRestarting}
      {models}
      {authProviders}
      {project}
      {skills}
      {skillsLoading}
      {skillsError}
      {onSettingsChange}
      {onApplicationConfigurationChange}
      {onRestartDaemon}
      {theme}
      {onThemeChange}
      {onSkillsRetry}
    />
  {/snippet}
</SettingsShell>
