<script lang="ts">
import MobileScreen from "$lib/presentation/shell/mobile/MobileScreen.svelte";
import MobileSection from "$lib/presentation/shell/mobile/MobileSection.svelte";
import MobileListRow from "$lib/presentation/shell/mobile/MobileListRow.svelte";
import MobileActionSheet from "$lib/presentation/shell/mobile/MobileActionSheet.svelte";
import FileCodeIcon from "@lucide/svelte/icons/file-code";
import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
import MessageSquareIcon from "@lucide/svelte/icons/message-square";
import NotebookIcon from "@lucide/svelte/icons/notebook";
import SettingsIcon from "@lucide/svelte/icons/settings";
import SquareTerminalIcon from "@lucide/svelte/icons/square-terminal";
import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import type { Attachment } from "svelte/attachments";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import DiscoverView from "$lib/app/discover/components/DiscoverView.svelte";
import LayoutControl from "$lib/app/shell/LayoutControl.svelte";
import MaintenanceStatus from "$lib/app/shell/MaintenanceStatus.svelte";
import StatusBar from "$lib/app/shell/StatusBar.svelte";
import StatusPopover from "$lib/app/shell/StatusPopover.svelte";
import { SubscriptionUsageChip } from "$lib/features/usage";
import Titlebar from "$lib/app/shell/Titlebar.svelte";
import ActivityPopover from "$lib/presentation/activity/ActivityPopover.svelte";
import NerveMark from "$lib/presentation/brand/NerveMark.svelte";
import MaintenanceProgressView from "$lib/presentation/maintenance/MaintenanceProgressView.svelte";
import {
  PanelHeader,
  PanelList,
  PanelRow,
  PanelView,
} from "$lib/presentation/panels";
import DockPanel from "$lib/presentation/shell/DockPanel.svelte";
import DockTabStrip from "$lib/presentation/shell/DockTabStrip.svelte";
import EditorArea from "$lib/presentation/shell/EditorArea.svelte";
import EditorTabStrip from "$lib/presentation/shell/EditorTabStrip.svelte";
import type { DockToggle } from "$lib/presentation/shell/ShellStatusBar.svelte";
import WorkbenchShell from "$lib/presentation/shell/WorkbenchShell.svelte";
import { defaultShellLayout } from "$lib/presentation/shell/shell-layout";
import {
  DOCK_LABELS,
  type DockId,
  type PanelViewDescriptor,
  type WorkbenchTabIdentity,
  type WorkbenchTabModel,
} from "$lib/presentation/shell/shell-types";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";
import {
  labActiveProject,
  labDiscoverModel,
  labGitStatus,
  labHomeDir,
  labLatestRelease,
  labNotifications,
  labProjectOptions,
  labProjects,
  labStatus,
  labUsages,
  labVersion,
} from "./shell-fixtures";

/* ----------------------------- Panel views ----------------------------- */

// Mirrors the real layout: conversations, files, launches and notes on the
// left; git and pull requests on the right. There is no bottom dock.
const descriptors: PanelViewDescriptor[] = [
  {
    id: "conversations",
    title: "Conversations",
    icon: MessageSquareIcon,
    defaultDock: "left",
    defaultOrder: 0,
  },
  {
    id: "files",
    title: "Files",
    icon: FolderTreeIcon,
    defaultDock: "left",
    defaultOrder: 1,
  },
  {
    id: "launches",
    title: "Launches",
    icon: SquareTerminalIcon,
    defaultDock: "left",
    defaultOrder: 2,
  },
  {
    id: "notes",
    title: "Scratch notes",
    icon: NotebookIcon,
    defaultDock: "left",
    defaultOrder: 3,
  },
  {
    id: "git",
    title: "Git changes",
    icon: GitBranchIcon,
    defaultDock: "right",
    defaultOrder: 0,
  },
  {
    id: "pull-requests",
    title: "Pull requests",
    icon: GitPullRequestIcon,
    defaultDock: "right",
    defaultOrder: 1,
  },
];

const dockPairs: DockId[] = ["left", "right"];

function viewsFor(dock: DockId): PanelViewDescriptor[] {
  return descriptors.filter((descriptor) => descriptor.defaultDock === dock);
}

let activeByDock = $state<Record<DockId, string>>({
  left: "conversations",
  right: "git",
  bottom: "",
});

const sampleConversations = [
  "Basically, I want to polish the UX in our application",
  "Make sure both of them follows the same state",
  "The plan mode present tool view not showing the body and footer",
  "Why I need to create the conversation in order to configure",
  "PR checks are failing can you fix it",
];

/* ------------------------------ Editor tabs ------------------------------ */

const initialTabs: WorkbenchTabModel[] = [
  {
    kind: "conversation",
    id: "c1",
    label: "The plan mode present tool view",
    icon: MessageSquareIcon,
    active: true,
  },
  {
    kind: "conversation",
    id: "c2",
    label: "Fix flaky reconnect test",
    icon: MessageSquareIcon,
    status: { tone: "info", pulse: true, label: "Running" },
  },
  {
    kind: "conversation",
    id: "c3",
    label: "Waiting for approval",
    icon: MessageSquareIcon,
    status: { tone: "warning", label: "Needs approval" },
  },
  {
    kind: "conversation",
    id: "c4",
    label: "Failed deploy rollback",
    icon: MessageSquareIcon,
    status: { tone: "destructive", label: "Failed" },
    error: "Run failed",
  },
  {
    kind: "file",
    id: "f1",
    label: "workbench-shell.svelte",
    icon: FileCodeIcon,
    draft: true,
  },
  {
    kind: "file",
    id: "f2",
    label: "a-really-long-file-name-that-needs-truncation-in-the-tab.config.ts",
    icon: FileCodeIcon,
    wide: true,
  },
  {
    kind: "settings",
    id: "s1",
    label: "Settings",
    icon: SettingsIcon,
    closeable: false,
  },
];

let tabs = $state<WorkbenchTabModel[]>(initialTabs.map((tab) => ({ ...tab })));
let manyTabs = $state<WorkbenchTabModel[]>(
  Array.from({ length: 16 }, (_, index) => ({
    kind: "file",
    id: `m${index}`,
    label: `module-${index + 1}.ts`,
    icon: FileCodeIcon,
    active: index === 2,
  })),
);

function activate(list: WorkbenchTabModel[], tab: WorkbenchTabIdentity) {
  for (const item of list)
    item.active = item.kind === tab.kind && item.id === tab.id;
}

function close(
  list: WorkbenchTabModel[],
  tab: WorkbenchTabIdentity,
): WorkbenchTabModel[] {
  return list.filter((item) => !(item.kind === tab.kind && item.id === tab.id));
}

function reorder(
  list: WorkbenchTabModel[],
  tab: WorkbenchTabIdentity,
  index: number,
): WorkbenchTabModel[] {
  const current = list.findIndex(
    (item) => item.kind === tab.kind && item.id === tab.id,
  );
  if (current < 0) return list;
  const next = [...list];
  const [moved] = next.splice(current, 1);
  next.splice(index, 0, moved);
  return next;
}

/* ------------------------------ Status bar ------------------------------ */

let toggles = $state<Record<DockId, boolean>>({
  left: true,
  right: true,
  bottom: false,
});
const dockToggles = $derived<DockToggle[]>(
  dockPairs.map((dock) => ({
    dock,
    label: DOCK_LABELS[dock].toLowerCase(),
    open: toggles[dock],
    onToggle: () => (toggles[dock] = !toggles[dock]),
  })),
);
let zoomLevel = $state(0);

const noop = () => {};

/* ------------------------------- Titlebar ------------------------------- */

// The titlebar renders in two specimens; each keeps its own popover state.
type TitlebarSlot = "shell" | "standalone";
let projectSwitcherOpen = $state<Record<TitlebarSlot, boolean>>({
  shell: false,
  standalone: false,
});
let activityOpen = $state<Record<TitlebarSlot, boolean>>({
  shell: false,
  standalone: false,
});

const longBranchGitStatus = {
  ...labGitStatus,
  branch: "fix/retain-resolved-plan-review-cards-with-a-long-name",
};

/* ------------------------------ Maintenance ------------------------------ */

const stamp = "2026-10-14T09:00:00.000Z";
const baseOperation = {
  id: "maint_1",
  revision: 1,
  kind: "delete_project",
  request: { kind: "delete_project", projectId: "proj_demo" },
  project: {
    id: "proj_demo",
    name: "nerve-workbench",
    directory: "/home/user/projects/nerve-workbench",
    createdAt: stamp,
    updatedAt: stamp,
  },
  status: "running",
  createdAt: stamp,
  updatedAt: stamp,
  phase: "running",
  message: "Deleting conversation history",
  cancellable: true,
  cancellationRequested: false,
  completedItems: 3,
  totalItems: 12,
  completedTargets: 0,
  totalTargets: 0,
  removedConversationCount: 3,
  removedLaunchCount: 5,
  skippedActiveAgentCount: 0,
  skippedActiveLaunchCount: 0,
  freedBytes: 0,
  warnings: [],
} as const satisfies MaintenanceOperation;

const runningOperation: MaintenanceOperation = {
  ...baseOperation,
  warnings: [],
  currentItem: {
    conversationId: "conv_01HZYABCDEF",
    title:
      "Refactor session store and a very long conversation title that truncates",
    stage: "tool_projections",
    removedRows: 18420,
    detachedLinks: 2,
  },
};

const operations: { title: string; operation: MaintenanceOperation }[] = [
  {
    title: "Preparing (indeterminate)",
    operation: {
      ...baseOperation,
      status: "queued",
      phase: "preparing",
      message: "Preparing to remove the project",
      completedItems: 0,
      removedConversationCount: 0,
      removedLaunchCount: 0,
      warnings: [],
    },
  },
  { title: "Running with current item", operation: runningOperation },
  {
    title: "Failed",
    operation: {
      ...baseOperation,
      status: "failed",
      message: "Project removal failed",
      cancellable: false,
      error: "SQLITE_BUSY: database is locked while deleting history records.",
      warnings: [],
    },
  },
];
let mobileActionsOpen = $state(false);

// The status popovers and the maintenance chip show their real panels open
// without a click. Open panels portal to the page body, so they open only
// while their frame is fully on screen: off-screen they would stretch the
// page, and they would trail their chips out of the catalog as it scrolls.
let usageOpen = $state(false);
let layoutOpen = $state(false);
let daemonOpen = $state(false);
let maintenanceOpen = $state(false);

function openWhileVisible(
  setOpen: (open: boolean) => void,
): Attachment<HTMLElement> {
  return (frame) => {
    const observer = new IntersectionObserver(
      ([entry]) => setOpen(entry?.isIntersecting ?? false),
      { threshold: 0.95 },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  };
}
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="The full workbench frame: the real titlebar and status bar views with mock data, left and right docks, editor tabs. Docks are resizable; the real frame fills the window (here 600px tall)."
  >
    <GallerySpecimen
      title="WorkbenchShell"
      source="presentation/shell/WorkbenchShell"
      usage="1 file · shell"
      layout="bare"
    >
      <div class="[&_.app-frame]:h-150! overflow-hidden rounded-md border">
        <WorkbenchShell
          layout={defaultShellLayout(descriptors, { collapsed: [] })}
          {descriptors}
        >
          {#snippet titlebar()}
            {@render titlebarView("shell")}
          {/snippet}
          {#snippet editor()}
            <EditorArea
              tabs={tabs.slice(0, 5)}
              onSelect={(tab) => activate(tabs, tab)}
              onClose={noop}
              onNew={noop}
            >
              {#snippet content()}
                <div class="p-4 text-ui text-muted-foreground">
                  Editor content
                </div>
              {/snippet}
            </EditorArea>
          {/snippet}
          {#snippet panelView(viewId)}
            {@render panelBody(viewId)}
          {/snippet}
          {#snippet statusBar()}
            {@render statusBarView()}
          {/snippet}
        </WorkbenchShell>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Titlebar & status bar"
    description="Window chrome on the panel surface."
  >
    <GallerySpecimen
      title="ShellTitlebar"
      source="app/shell/Titlebar → presentation/shell/ShellTitlebar"
      usage="1 file · shell"
      description="The real Titlebar view: NerveMark, ProjectSwitcher (four quick projects, one active, one running), VersionIndicator, Activity bell, Discover (setup dot), logs and settings. The switcher, version, and bell open their real popovers."
      surface="panel"
      layout="stack"
    >
      <div class="overflow-hidden rounded-md border">
        {@render titlebarView("standalone")}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ShellStatusBar"
      source="app/shell/StatusBar → presentation/shell/ShellStatusBar"
      usage="1 file · shell"
      description="The real StatusBar view: project path, git branch with change and ahead counts, SubscriptionUsageChip, LayoutControl and StatusPopover. Every chip opens its real popover; dock toggles are interactive."
      surface="panel"
      layout="stack"
    >
      <div class="overflow-hidden rounded-md border">
        {@render statusBarView()}
      </div>
      <p class="text-ui text-muted-foreground">
        Pending approvals add a warning chip; a reconnecting daemon swaps the
        connection dot.
      </p>
      <div class="overflow-hidden rounded-md border">
        <StatusBar
          activeProject={labActiveProject.project}
          connection="reconnecting"
          gitStatus={labGitStatus}
          pendingApprovals={2}
          onOpenPendingApproval={noop}
          subscriptionUsages={labUsages}
          status={labStatus}
          homeDir={labHomeDir}
          {zoomLevel}
          {dockToggles}
          onZoomLevelChange={(level) => (zoomLevel = level)}
        />
      </div>
      <p class="text-ui text-muted-foreground">
        Narrow window (640px): the left cluster truncates before the right
        chips.
      </p>
      <div class="w-160 max-w-full overflow-hidden rounded-md border">
        <StatusBar
          activeProject={labActiveProject.project}
          connection="connected"
          live
          gitStatus={longBranchGitStatus}
          subscriptionUsages={labUsages}
          status={labStatus}
          homeDir={labHomeDir}
          {zoomLevel}
          {dockToggles}
          onZoomLevelChange={(level) => (zoomLevel = level)}
        />
      </div>
      <p class="text-ui text-muted-foreground">
        Phone (below 640px): project name instead of path, no branch or layout
        chips, compact usage and connection dot.
      </p>
      <div class="w-96 max-w-full overflow-hidden rounded-md border">
        <StatusBar
          activeProject={labActiveProject.project}
          connection="connected"
          live
          phone
          gitStatus={labGitStatus}
          subscriptionUsages={labUsages}
          status={labStatus}
          homeDir={labHomeDir}
          {dockToggles}
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Status popovers"
      source="features/usage/SubscriptionUsageChip · app/shell/LayoutControl · app/shell/StatusPopover"
      usage="2 files · shell, mobile"
      description="The real status-bar chips with their panels open: usage (md), layout (sm) and daemon (sm) rise from their chips while this frame is on screen. Clicking outside closes them; click a chip to reopen."
      surface="panel"
      layout="bare"
    >
      <div
        class="flex min-h-104 flex-wrap items-end justify-center gap-4 rounded-md border bg-panel p-2"
        {@attach openWhileVisible((open) => {
          usageOpen = open;
          layoutOpen = open;
          daemonOpen = open;
        })}
      >
        <!-- Each slot is as wide as its panel, which opens end-aligned. -->
        <div class="flex w-80 justify-end">
          <SubscriptionUsageChip usages={labUsages} bind:open={usageOpen} />
        </div>
        <div class="flex w-64 justify-end">
          <LayoutControl
            {zoomLevel}
            {dockToggles}
            onZoomLevelChange={(level) => (zoomLevel = level)}
            bind:open={layoutOpen}
          />
        </div>
        <div class="flex w-64 justify-end">
          <StatusPopover
            connection="connected"
            live
            status={labStatus}
            bind:open={daemonOpen}
          />
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Docks"
    description="Icon-only tab strips and panels for the left and right docks (no bottom dock in this build)."
  >
    <GallerySpecimen
      title="DockTabStrip"
      source="presentation/shell/DockTabStrip"
      usage="2 files · shell"
      description="Left and right dock strips. Right-click a tab for the move/hide menu."
      surface="panel"
      layout="stack"
    >
      {#each dockPairs as dock (dock)}
        <div class="w-70 overflow-hidden rounded-md border">
          <DockTabStrip
            {dock}
            views={viewsFor(dock)}
            activeViewId={activeByDock[dock]}
            onSelect={(id) => (activeByDock[dock] = id)}
            onMove={noop}
            onHide={noop}
          />
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="DockPanel"
      source="presentation/shell/DockPanel"
      usage="1 file · shell"
      description="Tab strip plus panel body at 280px, the usual dock width."
      surface="panel"
      layout="bare"
    >
      <div class="flex flex-wrap gap-4">
        {#each dockPairs as dock (dock)}
          <div class="h-80 w-70 overflow-hidden rounded-md border">
            <DockPanel
              {dock}
              views={viewsFor(dock)}
              activeViewId={activeByDock[dock]}
              onSelect={(id) => (activeByDock[dock] = id)}
              onMove={noop}
              onHide={noop}
            >
              {#snippet panelView(viewId)}
                {@render panelBody(viewId)}
              {/snippet}
            </DockPanel>
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Editor tabs"
    description="Center tabs: conversations, files, settings, logs."
  >
    <GallerySpecimen
      title="EditorTabStrip"
      source="presentation/shell/EditorTabStrip"
      usage="2 files · shell"
      description="Active, running, needs approval, failed, draft (unsaved dot), long name (wide), non-closeable. Click, close, drag to reorder, right-click."
      surface="panel"
      layout="stack"
    >
      <div class="overflow-hidden rounded-md border">
        <EditorTabStrip
          {tabs}
          newShortcut="Ctrl+T"
          onSelect={(tab) => activate(tabs, tab)}
          onClose={(tab) => (tabs = close(tabs, tab))}
          onReorder={(tab, index) => (tabs = reorder(tabs, tab, index))}
          onRefresh={noop}
          onCloseOther={noop}
          onCloseLeft={noop}
          onCloseRight={noop}
          onNew={noop}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        class="self-start"
        onclick={() => (tabs = initialTabs.map((tab) => ({ ...tab })))}
        >Reset tabs</Button
      >
      <p class="text-ui text-muted-foreground">
        Overflowing strip (scroll chevrons) in a 640px center area:
      </p>
      <div class="w-160 max-w-full overflow-hidden rounded-md border">
        <EditorTabStrip
          tabs={manyTabs}
          onSelect={(tab) => activate(manyTabs, tab)}
          onClose={(tab) => (manyTabs = close(manyTabs, tab))}
          onNew={noop}
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Maintenance & brand"
    description="Progress shown in the status bar and storage settings; the Nerve mark in the titlebar."
  >
    <GallerySpecimen
      title="MaintenanceProgressView"
      source="presentation/maintenance/MaintenanceProgressView"
      usage="2 files · shell, settings"
      description="Preparing, running with current item, failed."
      surface="card"
      layout="bare"
    >
      <div class="grid gap-4 md:grid-cols-3">
        {#each operations as item (item.title)}
          <div
            class="flex min-w-0 flex-col gap-2 rounded-md border bg-popover p-3"
          >
            <span class="text-ui text-muted-foreground">{item.title}</span>
            <MaintenanceProgressView
              operation={item.operation}
              onCancel={noop}
            />
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="MaintenanceStatus"
      source="app/shell/MaintenanceStatus"
      usage="2 files · shell, mobile"
      description="The status-bar chip for a running cleanup (3/12 items), open on its real progress panel while this frame is on screen. Cancel is a no-op."
      surface="panel"
      layout="bare"
    >
      <div
        class="flex min-h-88 items-end justify-center rounded-md border bg-panel p-2"
        {@attach openWhileVisible((open) => (maintenanceOpen = open))}
      >
        <MaintenanceStatus
          operation={runningOperation}
          onCancel={noop}
          bind:open={maintenanceOpen}
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="NerveMark"
      source="presentation/brand/NerveMark"
      usage="2 files · shell"
      description="Titlebar size (size-5) and a large reference; inherits currentColor."
    >
      <NerveMark class="size-5 text-foreground" label="Nerve" />
      <NerveMark class="size-16 text-primary" label="Nerve" />
    </GallerySpecimen>
  </GalleryGroup>
  <GalleryGroup title="Shared presentation">
    <GallerySpecimen
      title="MobileScreen"
      source="presentation/shell/mobile/MobileScreen.svelte"
      layout="stack"
    >
      <div class="w-96">
        <MobileScreen title="Conversations" subtitle="nerve" onBack={() => {}}
          ><MobileSection title="Recent"
            ><MobileListRow
              title="Design-system cleanup"
              detail="Review shared components"
              selected
            /><MobileListRow
              title="Reconnect tests"
              tone="info"
              detail="Running"
              onclick={() => (mobileActionsOpen = true)}
            /></MobileSection
          ></MobileScreen
        >
      </div>
    </GallerySpecimen>
    <GallerySpecimen
      title="MobileSection"
      source="presentation/shell/mobile/MobileSection.svelte"
      layout="stack"
    >
      <div class="w-96">
        <MobileSection title="Projects" meta="2"
          ><MobileListRow title="nerve" selected /><MobileListRow
            title="Documentation"
          /></MobileSection
        >
      </div>
    </GallerySpecimen>
    <GallerySpecimen
      title="MobileListRow"
      source="presentation/shell/mobile/MobileListRow.svelte"
      layout="stack"
    >
      <div class="w-96">
        <MobileListRow
          title="Review complete"
          detail="All checks passed"
          tone="success"
        /><MobileListRow
          title="Needs approval"
          detail="Run the build"
          tone="warning"
        />
      </div>
    </GallerySpecimen>
    <GallerySpecimen
      title="MobileActionSheet"
      source="presentation/shell/mobile/MobileActionSheet.svelte"
      layout="stack"
    >
      <div class="w-96">
        <MobileListRow
          title="Conversation actions"
          detail="Tap to open the action sheet"
          onclick={() => (mobileActionsOpen = true)}
        /><MobileActionSheet
          open={mobileActionsOpen}
          title="Design-system cleanup"
          items={[
            { label: "Open", onSelect: () => {} },
            { label: "Rename", disabled: true },
            { label: "Delete", destructive: true, onSelect: () => {} },
          ]}
          onOpenChange={(open) => (mobileActionsOpen = open)}
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Discover"
    description="The Discover center tab: the real DiscoverView with the shipped news and tips and mock guide progress. Actions are no-ops."
  >
    <GallerySpecimen
      title="DiscoverView"
      source="app/discover/components/DiscoverView"
      usage="1 file · discover"
      description="Featured release news, artwork cards, archived updates, Get set up with a must-do guide and tours, completed guides and tips."
      layout="bare"
    >
      <div class="h-200 overflow-hidden rounded-md border">
        <DiscoverView
          model={labDiscoverModel}
          workbenchBlocked={false}
          onStartGuide={noop}
          onMarkCompleted={noop}
          onAction={noop}
          onSetAutoOpen={noop}
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>

{#snippet titlebarView(slot: TitlebarSlot)}
  <Titlebar
    projects={labProjects}
    projectOptions={labProjectOptions}
    activeProjectKey={labActiveProject.key}
    homeDir={labHomeDir}
    currentVersion={labVersion}
    latestRelease={labLatestRelease}
    applicationLogsEnabled
    discoverBadge={{ kind: "dot" }}
    bind:projectSwitcherOpen={projectSwitcherOpen[slot]}
    onOpenProject={noop}
    onOpenProjectPath={noop}
    onSelectProject={noop}
    onOpenLogs={noop}
    onOpenDiscover={noop}
    onOpenSettings={noop}
  >
    {#snippet activity()}
      <ActivityPopover
        items={labNotifications}
        open={activityOpen[slot]}
        onOpenChange={(open) => (activityOpen[slot] = open)}
        onOpenItem={noop}
        onAction={noop}
        onDismiss={noop}
        onClearFinished={noop}
        onToggleMute={noop}
      />
    {/snippet}
  </Titlebar>
{/snippet}

{#snippet statusBarView()}
  <StatusBar
    activeProject={labActiveProject.project}
    connection="connected"
    live
    gitStatus={labGitStatus}
    subscriptionUsages={labUsages}
    status={labStatus}
    homeDir={labHomeDir}
    {zoomLevel}
    {dockToggles}
    onZoomLevelChange={(level) => (zoomLevel = level)}
  />
{/snippet}

{#snippet panelBody(viewId: string)}
  {#if viewId === "conversations"}
    <PanelView>
      <PanelHeader title="Conversations" count={158} class="px-2" />
      <PanelList ariaLabel="Conversations" class="gap-1 pb-0">
        {#each sampleConversations as title, index (title)}
          <PanelRow label={title} labelLines={2} active={index === 2}>
            {#snippet leading()}
              <StatusDot
                tone={index === 2 ? "info" : "neutral"}
                size="md"
                variant={index === 2 ? "solid" : "outline"}
              />
            {/snippet}
          </PanelRow>
        {/each}
      </PanelList>
    </PanelView>
  {:else}
    <div class="p-3 text-ui text-muted-foreground">
      Panel body for “{viewId}”. See the Panels page for real content.
    </div>
  {/if}
{/snippet}
