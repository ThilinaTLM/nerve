<script lang="ts">
import Titlebar from "$lib/app/shell/Titlebar.svelte";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { getShortcutLabel } from "$lib/core/shortcuts/registry";
import { shortProjectLabel } from "$lib/core/utils/project-tree";
import PruneConversationsDialog from "$lib/features/projects/components/PruneConversationsDialog.svelte";
import type {
  DeleteTarget,
  PruneTarget,
} from "$lib/features/projects/components/project-agent-tree-props";
import {
  buildProjectMenu,
  countAgeEligible,
  countKeepEligible,
  countProjectConversations,
  type ProjectTreeMenuContext,
} from "$lib/features/projects/components/project-tree-menus";
import type { ProjectSwitcherItem } from "$lib/features/projects";
import {
  closeDesktopWindow,
  desktopRuntime,
  desktopShutdownState,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "$lib/features/desktop";
import { openAuthPane } from "$lib/features/auth";
import { openLogsPane } from "$lib/features/logs";
import { openSettingsPane, settingsSelectors } from "$lib/features/settings";
import {
  deleteProjectAndRefresh,
  newConversationInProject,
  openProjectInEditorAndNotify,
  pruneProjectConversationsAndRefresh,
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/features/workspace";
import { quickProjectItems } from "$lib/features/projects";
import { responsive } from "$lib/app/shell/responsive.svelte";

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
const desktopQuitting = $derived(
  desktopRuntime.quitting || desktopShutdownState.quitRequested,
);
const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir: status?.storage.home,
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
      label: shortProjectLabel(project.dir, status?.storage.home),
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
  maximized={desktopRuntime.windowState.maximized}
  closeToTray={settingsDraft?.desktop.closeToTray ?? true}
  quitting={desktopQuitting}
  settingsActive={activeCenterTab?.kind === "settings"}
  authActive={activeCenterTab?.kind === "auth"}
  logsActive={activeCenterTab?.kind === "logs"}
  buildProjectMenuItems={projectMenuItems}
  onOpenProject={openProjectPicker}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenLogs={() => openLogsPane()}
  onOpenAuth={() => openAuthPane()}
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
