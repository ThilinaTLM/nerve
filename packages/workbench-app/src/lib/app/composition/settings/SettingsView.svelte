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
  resolveSurfacePageId,
  settingsNavFor,
  settingsPagesFor,
} from "$lib/features/settings/registry/settings-pages";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import { notify } from "$lib/application/notifications/notify.svelte";
import SettingsPageActions from "./SettingsPageActions.svelte";
import SettingsPageContent from "./SettingsPageContent.svelte";
import { createSettingsPageControllers } from "./settings-page-controllers.svelte";

type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean },
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
  /** The open project. It adds a column and a nav group. */
  project?: Project;
  /** Items that need the user, per page. */
  attention?: { pages: Readonly<Record<string, number>> };
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
  attention = { pages: {} },
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

const surface = $derived({ projectName: project?.name });

const pages = $derived(
  settingsPagesFor(surface).map((page) =>
    page.detail && detailItems[page.id]
      ? { ...page, detail: { ...page.detail, items: detailItems[page.id] } }
      : page,
  ),
);

/** Pages with items that need the user show their count. */
const badges = $derived(
  Object.fromEntries(
    Object.entries(attention.pages)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => [
        id,
        { text: String(count), tone: "warning" as const },
      ]),
  ),
);
const groups = $derived(settingsNavFor(surface, badges));

// Stale ids (restored state, old links) land on the default page.
$effect(() => {
  const resolved = resolveSurfacePageId(activePageId);
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
      {controllers}
      {settingsDraft}
      {project}
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
      onOpenPage={(pageId, item) => {
        activePageId = pageId;
        activeItemId = item ?? "";
      }}
    />
  {/snippet}
</SettingsShell>
