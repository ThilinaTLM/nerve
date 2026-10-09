<script lang="ts">
import Titlebar from "$lib/app/shell/Titlebar.svelte";
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { getShortcutLabel } from "$lib/application/commands/command-registry";
import {
  buildProjectMenu,
  countProjectConversations,
  type DeleteTarget,
  type ProjectSwitcherItem,
  type ProjectTreeMenuContext,
} from "$lib/features/projects";
import {
  closeDesktopWindow,
  desktopRuntime,
  desktopShutdownState,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "$lib/platform/desktop";
import { releaseSelectors } from "$lib/features/releases";
import { openLogsPane } from "$lib/features/logs";
import { discoverTitlebarBadge, openDiscoverPane } from "$lib/app/discover";
import { guideState } from "$lib/app/discover/guides";
import { settingsSelectors } from "$lib/features/settings";
import { openSettingsPane } from "$lib/application/settings";
import {
  deleteProjectAndRefresh,
  newConversationInProject,
  openProjectInEditorAndNotify,
  openProjectInTerminalAndNotify,
  maintenance,
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";
import { quickProjectItems } from "$lib/features/projects";
import { responsive } from "$lib/app/shell/responsive.svelte";
import { resolveHeaderType } from "$lib/app/shell/header-type";

const projectItems = $derived(workspaceSelectors.projectSwitcherItems);
const status = $derived(workspaceSelectors.status);
const conversations = $derived(workspaceSelectors.conversations);
const newConversationShortcut = getShortcutLabel("conversation.new");

let pendingDelete = $state<DeleteTarget | undefined>();
const quickLimit = $derived(
  responsive.isPhone ? 1 : responsive.isCompact ? 2 : 5,
);
const quickProjects = $derived(
  quickProjectItems(
    projectItems,
    workspaceState.selectedProjectKey,
    quickLimit,
  ),
);
const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
const settingsDraft = $derived(settingsSelectors.settingsDraft);
const headerType = $derived(
  resolveHeaderType(
    settingsDraft?.desktop.headerType ?? "auto",
    desktopRuntime.platform,
  ),
);
const discoverAttention = $derived(discoverTitlebarBadge());
const desktopQuitting = $derived(
  desktopRuntime.quitting || desktopShutdownState.quitRequested,
);
const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir: status?.storage.userHome,
  newConversationShortcut,
  editorAvailability: status?.runtime.editors,
  terminalAvailability: status?.runtime.terminal,
  conversationCount: (projectId) =>
    countProjectConversations(conversations, projectId),
  maintenanceActive: maintenance.active,
  onNewConversationInProject: newConversationInProject,
  onOpenProjectInEditor: (projectId, editor) =>
    void openProjectInEditorAndNotify(projectId, editor),
  onOpenProjectInTerminal: (projectId) =>
    void openProjectInTerminalAndNotify(projectId),
  requestDelete: (target) => (pendingDelete = target),
});

function projectMenuItems(item: ProjectSwitcherItem) {
  return buildProjectMenu(item.project, menuContext);
}

function confirmDelete() {
  if (pendingDelete?.kind === "project" && !maintenance.active) {
    void deleteProjectAndRefresh(pendingDelete.id);
  }
}

function openProjectBrowser() {
  workspaceState.projectPickerMode = "browse";
  workspaceState.projectPickerOpen = true;
}

async function handleDesktopClose() {
  const closeToTray = settingsDraft?.desktop.closeToTray ?? true;
  if (!closeToTray) {
    desktopShutdownState.quitRequested = true;
    desktopRuntime.quitting = true;
  }
  try {
    await closeDesktopWindow({ closeToTray });
  } catch (caught) {
    if (!closeToTray) {
      desktopShutdownState.quitRequested = false;
      desktopRuntime.quitting = false;
    }
    workspaceState.error =
      caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<Titlebar
  projects={quickProjects}
  projectOptions={projectItems}
  activeProjectKey={workspaceState.selectedProjectKey}
  homeDir={status?.storage.userHome}
  desktop={desktopRuntime.isDesktop}
  developmentSlot={desktopRuntime.developmentSlot}
  {headerType}
  maximized={desktopRuntime.windowState.maximized}
  closeToTray={settingsDraft?.desktop.closeToTray ?? true}
  quitting={desktopQuitting}
  settingsActive={activeCenterTab?.kind === "settings"}
  discoverActive={activeCenterTab?.kind === "discover" ||
    guideState.mode !== "closed"}
  discoverBadge={discoverAttention}
  logsActive={activeCenterTab?.kind === "logs"}
  applicationLogsEnabled={status?.capabilities.applicationLogs ?? false}
  currentVersion={status?.version}
  latestRelease={releaseSelectors.latest}
  buildProjectMenuItems={projectMenuItems}
  onOpenProject={openProjectBrowser}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenLogs={() => openLogsPane()}
  onOpenDiscover={openDiscoverPane}
  onOpenSettings={() => void openSettingsPane()}
  onMinimize={() => void minimizeDesktopWindow()}
  onToggleMaximize={() => void toggleMaximizeDesktopWindow()}
  onClose={() => void handleDesktopClose()}
/>

<AlertDialog
  open={pendingDelete?.kind === "project"}
  title="Remove project?"
  description={pendingDelete
    ? `This removes “${pendingDelete.label}” from Nerve and deletes its Nerve conversations. Files on disk are not deleted.`
    : ""}
  confirmLabel="Remove"
  destructive
  onConfirm={confirmDelete}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
