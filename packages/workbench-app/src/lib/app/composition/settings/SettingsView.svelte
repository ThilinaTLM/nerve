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
import type { ProjectGuide } from "$lib/application/configuration-attention/project-guides";
import { notify } from "$lib/application/notifications/notify.svelte";
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
  /** Open detail item of the active page; "" shows the list. */
  activeItemId?: string;
  /** Valid detail items per page id (the detail view names itself). */
  detailItems?: Readonly<Record<string, { id: string; label: string }[]>>;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  /** The project of a project target. */
  project?: Project;
  /** Switching between your settings and the project's. */
  scopeLinks?: {
    onOpenUser: () => void;
    project?: { id: string; name: string; path?: string; onOpen: () => void };
  };
  /** Items that need the user: in the project, and per page of this scope. */
  attention?: { project: number; pages: Readonly<Record<string, number>> };
  /** "In this project" rows by user page id. */
  guides?: Readonly<Record<string, ProjectGuide>>;
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
  activeItemId = $bindable(""),
  detailItems = {},
  models = [],
  authProviders = [],
  project,
  scopeLinks,
  attention = { project: 0, pages: {} },
  guides = {},
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
  settingsPagesFor(target).map((page) => {
    const withDetail =
      page.detail && detailItems[page.id]
        ? { ...page, detail: { ...page.detail, items: detailItems[page.id] } }
        : page;
    return page.id === "skills"
      ? {
          ...withDetail,
          sections: skillSections.length > 0 ? skillSections : page.sections,
          description: skillsDescription,
        }
      : withDetail;
  }),
);

/**
 * Pages with items that need the user show their count; project pages that
 * differ from the user's settings show how many differ.
 */
const badges = $derived({
  ...Object.fromEntries(
    Object.entries(target.kind === "project" ? controllers.pageDiffs() : {})
      .filter(([, count]) => count > 0)
      .map(([id, count]) => [
        id,
        { text: String(count), tone: "info" as const },
      ]),
  ),
  ...Object.fromEntries(
    Object.entries(attention.pages)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => [
        id,
        { text: String(count), tone: "warning" as const },
      ]),
  ),
});
const groups = $derived(settingsNavFor(target, badges));
const scopeHeader = $derived.by(() => {
  const open = scopeLinks?.project;
  const named =
    open ??
    (target.kind === "project"
      ? { name: project?.name ?? "Project", path: project?.directory }
      : undefined);
  return settingsScopeHeader(target, {
    ...(named ? { project: { ...named, pending: attention.project } } : {}),
    onOpenUser: scopeLinks?.onOpenUser ?? (() => undefined),
    onOpenProject: open?.onOpen ?? (() => undefined),
  });
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
  bind:activeItemId
  onUnknownItem={(item, page) =>
    notify.warning(`${page.label} item "${item}" was not found`, {
      description: "Showing the list instead.",
    })}
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

  {#snippet children(page, itemId)}
    <SettingsPageContent
      {page}
      {itemId}
      sectionId={activeSectionId}
      onOpenItem={(id, section) => {
        activeItemId = id;
        if (section) activeSectionId = section;
      }}
      onCloseItem={() => (activeItemId = "")}
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
      guide={guides[page.id]}
      onOpenGuide={scopeLinks?.project?.onOpen}
    />
  {/snippet}
</SettingsShell>
