<script lang="ts">
import type { UnreadableConversation } from "@nervekit/contracts/activity";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  UpgradeReportNotice,
  hasUpgradeReports,
  loadUpgradeReports,
} from "$lib/features/storage-upgrade";
import SettingsHealthItem from "$lib/presentation/activity/SettingsHealthItem.svelte";
import ProjectConfigurationHealthItem from "$lib/presentation/activity/ProjectConfigurationHealthItem.svelte";
import { projectConfigurationHealth } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import { settingsHealth } from "$lib/application/settings/settings-health-state.svelte";
import ActivityPopover from "$lib/presentation/activity/ActivityPopover.svelte";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { unseenResults } from "$lib/application/activity/unseen-results.svelte";
import { attentionMute } from "$lib/application/notifications";
import { deriveNeedsYou } from "$lib/application/activity/needs-you";
import { buildNotifications } from "$lib/presentation/activity/notifications";
import Titlebar from "$lib/app/shell/Titlebar.svelte";
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { getShortcutLabel } from "$lib/application/commands/command-registry";
import { shortProjectLabel } from "$lib/domain/projects/project-tree";
import {
  buildProjectMenu,
  countAgeEligible,
  countCompletedEligible,
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
import { releaseSelectors } from "$lib/features/releases";
import { openLogsPane } from "$lib/features/logs";
import { discoverTitlebarBadge, openDiscoverPane } from "$lib/app/discover";
import { guideState } from "$lib/app/discover/guides";
import { settingsSelectors } from "$lib/features/settings";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
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
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import {
  sidebarConversations,
  pruneProjectConversationsAndRefresh,
} from "$lib/features/projects";
import { quickProjectItems } from "$lib/features/projects";
import { responsive } from "$lib/app/shell/responsive.svelte";
import { resolveHeaderType } from "$lib/app/shell/header-type";

const projectItems = $derived(workspaceSelectors.projectSwitcherItems);
const status = $derived(workspaceSelectors.status);
const conversations = $derived(
  sidebarConversations(workspaceSelectors.conversations),
);
const notifications = $derived(
  buildNotifications({
    activities: activityInbox.activities,
    needsYou: deriveNeedsYou({
      conversations: workspaceSelectors.conversations,
      activityById: workspaceSelectors.conversationActivityById,
      projectNameById: Object.fromEntries(
        workspaceSelectors.projects.map((project) => [
          project.id,
          project.name,
        ]),
      ),
    }),
    activeProjectId: workspaceSelectors.activeProject?.id,
    readIds: activityInbox.readIds,
  }),
);
const unseenConversationFailure = $derived(
  notifications.some(
    (item) => item.conversationId && item.kind === "failed" && item.unread,
  ),
);

function dismissNotification(id: string): void {
  const finished = notifications.find(
    (item) =>
      item.id === id && item.conversationId && item.kind === "succeeded",
  );
  if (finished?.conversationId) unseenResults.delete(finished.conversationId);
  else void activityInbox.action("dismiss", id);
}

function clearFinished(): void {
  unseenResults.clear();
  void activityInbox.clear();
}
const projectIssues = $derived(
  Object.values(projectConfigurationHealth.byProject).flat(),
);
const newConversationShortcut = getShortcutLabel("conversation.new");

let pendingDelete = $state<DeleteTarget | undefined>();
let unreadableDelete = $state<UnreadableConversation>();
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
  onOpenProjectSettings: (projectId) => void openProjectSettingsPane(projectId),
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
  if (pendingDelete?.kind === "project" && !maintenance.active) {
    void deleteProjectAndRefresh(pendingDelete.id);
  }
}

function confirmPrune(
  request: Parameters<typeof pruneProjectConversationsAndRefresh>[1],
) {
  if (pendingPrune && !maintenance.active) {
    void pruneProjectConversationsAndRefresh(pendingPrune.id, request);
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
let reportsLoaded = false;
$effect(() => {
  if (
    !reportsLoaded &&
    workbenchStartupState.progressiveActive &&
    workspaceState.connection === "connected"
  ) {
    reportsLoaded = true;
    void loadUpgradeReports();
  }
});
</script>

{#snippet settingsHealthItem()}
  <SettingsHealthItem
    health={settingsHealth.notice.health}
    pending={settingsHealth.notice.pending}
    error={settingsHealth.notice.error}
    onReset={(id) => {
      activityInbox.setOpen(false);
      settingsHealth.resetId = id;
    }}
    onReload={(id) => void settingsHealth.resolve({ id, action: "reload" })}
    onRetry={() => void settingsHealth.refresh()}
  />
{/snippet}

{#snippet attentionItems()}
  <UpgradeReportNotice home={status?.storage.home} />
  {#if settingsHealth.notice.health.invalid.length || settingsHealth.notice.error}
    {@render settingsHealthItem()}
  {/if}
  {#if projectIssues.length}
    <ProjectConfigurationHealthItem
      issues={projectIssues}
      projectName={(id) =>
        workspaceSelectors.projects.find((project) => project.id === id)?.name}
      pending={projectConfigurationHealth.pending}
      error={projectConfigurationHealth.error}
      onOpen={(issue) => {
        activityInbox.setOpen(false);
        void projectConfigurationHealth.open(issue);
      }}
      onReload={(issue) => void projectConfigurationHealth.reload(issue)}
      onReset={(issue) => {
        activityInbox.setOpen(false);
        projectConfigurationHealth.requestReset(issue);
      }}
    />
  {/if}
{/snippet}

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
>
  {#snippet activity()}
    <ActivityPopover
      items={notifications}
      error={activityInbox.error}
      unseenFailure={activityInbox.unseenFailure || unseenConversationFailure}
      muted={attentionMute.muted}
      attention={settingsHealth.notice.health.invalid.length ||
      settingsHealth.notice.error ||
      projectIssues.length ||
      hasUpgradeReports()
        ? attentionItems
        : undefined}
      open={activityInbox.open}
      onOpenChange={activityInbox.setOpen}
      onOpenItem={(item) => {
        if (!item.conversationId) return;
        activityInbox.setOpen(false);
        void openConversation(item.conversationId);
      }}
      onAction={(intent, item) => {
        if (intent === "open") {
          if (item.conversationId) {
            activityInbox.setOpen(false);
            void openConversation(item.conversationId);
          }
        } else void activityInbox.action(intent, item.id);
      }}
      onDeleteConversation={(entry) => {
        activityInbox.setOpen(false);
        unreadableDelete = entry;
      }}
      onDismiss={dismissNotification}
      onClearFinished={clearFinished}
      onToggleMute={() =>
        attentionMute.muted ? attentionMute.unmute() : attentionMute.mute()}
      onViewed={activityInbox.markRead}
    />
  {/snippet}
</Titlebar>

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
  completedEligible={() =>
    pendingPrune ? countCompletedEligible(conversations, pendingPrune.id) : 0}
  disabled={maintenance.active}
  onConfirm={confirmPrune}
  onOpenChange={(open) => {
    if (!open) pendingPrune = undefined;
  }}
/>

<AlertDialog
  open={!!unreadableDelete}
  title="Delete unreadable conversation?"
  description={unreadableDelete
    ? `Delete “${unreadableDelete.title || unreadableDelete.id}” and all its descendants? Their stored messages and files will be permanently removed.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (unreadableDelete)
      void activityInbox.deleteConversation(unreadableDelete.id);
  }}
  onOpenChange={(open) => {
    if (!open) unreadableDelete = undefined;
  }}
/>
