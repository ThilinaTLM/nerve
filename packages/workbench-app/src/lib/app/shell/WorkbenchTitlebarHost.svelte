<script lang="ts">
import Titlebar from "$lib/app/shell/Titlebar.svelte";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { getShortcutLabel } from "$lib/kernel/shortcuts/registry";
import { shortProjectLabel } from "$lib/kernel/utils/project-tree";
import {
  buildProjectMenu,
  countAgeEligible,
  countKeepEligible,
  countProjectConversations,
  PruneConversationsDialog,
  type DeleteTarget,
  type ProjectSwitcherItem,
  type ProjectTreeMenuContext,
  type PruneTarget,
} from "$lib/features/projects";
import {
  closeDesktopWindow,
  desktopRuntime,
  desktopShutdownState,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "$lib/platform/desktop";
import { releaseState } from "$lib/features/releases";
import { openLogsPane } from "$lib/features/logs";
import {
  guideState,
  incompleteGuideCount,
  openGuide,
} from "$lib/app/onboarding";
import { settingsSelectors } from "$lib/features/settings";
import { openSettingsPane } from "$lib/application/settings";
import {
  deleteProjectAndRefresh,
  newConversationInProject,
  openProjectInEditorAndNotify,
  pruneProjectConversationsAndRefresh,
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
let pendingPrune = $state<PruneTarget | undefined>();
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
const incompleteGuides = $derived(incompleteGuideCount());
const desktopQuitting = $derived(
  desktopRuntime.quitting || desktopShutdownState.quitRequested,
);
const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir: status?.storage.userHome,
  newConversationShortcut,
  editorAvailability: status?.runtime.editors,
  conversationCount: (projectId) =>
    countProjectConversations(conversations, projectId),
  onNewConversationInProject: newConversationInProject,
  onOpenProjectInEditor: (projectId, editor) =>
    void openProjectInEditorAndNotify(projectId, editor),
  requestPrune: (project) => {
    pendingPrune = {
      id: project.id,
      label: shortProjectLabel(project.dir, status?.storage.userHome),
    };
  },
  requestDelete: (target) => (pendingDelete = target),
});

function projectMenuItems(item: ProjectSwitcherItem) {
  return buildProjectMenu(item.project, menuContext);
}

function confirmDelete() {
  if (pendingDelete?.kind === "project") {
    void deleteProjectAndRefresh(pendingDelete.id);
  }
}

function confirmPrune(
  request: Parameters<typeof pruneProjectConversationsAndRefresh>[1],
) {
  if (pendingPrune) {
    void pruneProjectConversationsAndRefresh(pendingPrune.id, request);
  }
}

function openProjectPicker() {
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
  activeProjectKey={workspaceState.selectedProjectKey}
  desktop={desktopRuntime.isDesktop}
  {headerType}
  maximized={desktopRuntime.windowState.maximized}
  closeToTray={settingsDraft?.desktop.closeToTray ?? true}
  quitting={desktopQuitting}
  settingsActive={activeCenterTab?.kind === "settings"}
  guideActive={guideState.mode === "catalog" ||
    guideState.mode === "tour" ||
    guideState.mode === "preparing-coach" ||
    guideState.mode === "coach"}
  incompleteGuideCount={incompleteGuides}
  logsActive={activeCenterTab?.kind === "logs"}
  applicationLogsEnabled={status?.capabilities.applicationLogs ?? false}
  currentVersion={status?.version}
  latestRelease={releaseState.latest}
  buildProjectMenuItems={projectMenuItems}
  onOpenProject={openProjectPicker}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenLogs={() => openLogsPane()}
  onOpenGuide={openGuide}
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

<PruneConversationsDialog
  open={!!pendingPrune}
  projectLabel={pendingPrune?.label ?? ""}
  totalCount={pendingPrune
    ? countProjectConversations(conversations, pendingPrune.id)
    : 0}
  ageEligible={(days) =>
    pendingPrune ? countAgeEligible(conversations, pendingPrune.id, days) : 0}
  keepEligible={(keep) =>
    pendingPrune ? countKeepEligible(conversations, pendingPrune.id, keep) : 0}
  onConfirm={confirmPrune}
  onOpenChange={(open) => {
    if (!open) pendingPrune = undefined;
  }}
/>
