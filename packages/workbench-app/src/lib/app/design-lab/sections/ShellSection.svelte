<script lang="ts">
import CompassIcon from "@lucide/svelte/icons/compass";
import FileCodeIcon from "@lucide/svelte/icons/file-code";
import FolderIcon from "@lucide/svelte/icons/folder";
import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
import ListIcon from "@lucide/svelte/icons/list";
import MessageSquareIcon from "@lucide/svelte/icons/message-square";
import NotebookIcon from "@lucide/svelte/icons/notebook";
import SettingsIcon from "@lucide/svelte/icons/settings";
import SquareTerminalIcon from "@lucide/svelte/icons/square-terminal";
import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import PopoverPanel, {
  PopoverBody,
  PopoverHeader,
  PopoverMeter,
  PopoverProperties,
  PopoverProperty,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
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
import ShellStatusBar, {
  type DockToggle,
} from "$lib/presentation/shell/ShellStatusBar.svelte";
import ShellTitlebar from "$lib/presentation/shell/ShellTitlebar.svelte";
import WorkbenchShell from "$lib/presentation/shell/WorkbenchShell.svelte";
import { defaultShellLayout } from "$lib/presentation/shell/shell-layout";
import type {
  DockId,
  PanelViewDescriptor,
  WorkbenchTabIdentity,
  WorkbenchTabModel,
} from "$lib/presentation/shell/shell-types";
import {
  STATUS_BAR_CHIP,
  STATUS_BAR_CHIP_BUTTON,
} from "$lib/presentation/shell/status-bar-chip";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

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
    label: `${dock} panel`,
    open: toggles[dock],
    onToggle: () => (toggles[dock] = !toggles[dock]),
  })),
);

const noop = () => {};

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
  {
    title: "Running with current item",
    operation: {
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
    },
  },
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
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="The full workbench frame: titlebar, left and right docks, editor tabs and status bar. Docks are resizable; the real frame fills the window (here 600px tall)."
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
            {@render titlebarMock()}
          {/snippet}
          {#snippet editor()}
            <EditorArea
              tabs={tabs.slice(0, 5)}
              onSelect={(tab) => activate(tabs, tab)}
              onClose={noop}
              onNew={noop}
            >
              {#snippet content()}
                <div class="p-4 text-sm text-muted-foreground">
                  Editor content
                </div>
              {/snippet}
            </EditorArea>
          {/snippet}
          {#snippet panelView(viewId)}
            {@render panelBody(viewId)}
          {/snippet}
          {#snippet statusBar()}
            {@render statusBarMock()}
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
      source="presentation/shell/ShellTitlebar"
      usage="1 file · shell"
      description="Logo, project chips (active one numbered), version tag, discover/list/settings icons."
      surface="panel"
      layout="stack"
    >
      <div class="overflow-hidden rounded-md border">
        {@render titlebarMock()}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ShellStatusBar"
      source="presentation/shell/ShellStatusBar"
      usage="1 file · shell"
      description="Chips share STATUS_BAR_CHIP (h-6, text-xs). Layout and Connected open real popovers; dock toggles are interactive."
      surface="panel"
      layout="stack"
    >
      <div class="overflow-hidden rounded-md border">
        {@render statusBarMock()}
      </div>
      <p class="text-xs text-muted-foreground">
        Narrow window: the left cluster truncates before the right chips.
      </p>
      <div class="h-7 w-96 overflow-hidden rounded-md border">
        <ShellStatusBar toggles={dockToggles}>
          {#snippet left()}
            <span class={`${STATUS_BAR_CHIP} truncate`}
              >fix/retain-resolved-plan-review-cards-with-a-long-name</span
            >
          {/snippet}
          {#snippet right()}
            <span class={STATUS_BAR_CHIP}>100%</span>
          {/snippet}
        </ShellStatusBar>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Status popovers"
      source="composites/popover-panel"
      usage="17 files · composer, shell, settings, git, projects"
      description="Usage (md), layout (sm) and daemon (sm) panels as opened from the status bar. Static replicas of the open state."
      surface="panel"
      layout="bare"
    >
      <div class="flex flex-wrap items-start gap-6">
        <div class="floating-surface popover-content popover-md">
          {@render usagePanel()}
        </div>
        <div class="floating-surface popover-content popover-md">
          {@render layoutPanel()}
        </div>
        <div class="floating-surface popover-content popover-sm">
          {@render daemonPanel()}
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
      <p class="text-xs text-muted-foreground">
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
            <span class="text-xs font-medium text-muted-foreground"
              >{item.title}</span
            >
            <MaintenanceProgressView
              operation={item.operation}
              onCancel={noop}
            />
          </div>
        {/each}
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
</div>

{#snippet titlebarMock()}
  <ShellTitlebar>
    {#snippet left()}
      <NerveMark class="size-5 shrink-0" label="Nerve" />
      <Button variant="ghost" size="sm">90Events</Button>
      <Button variant="ghost" size="sm">EasyLink</Button>
      <Button variant="outline" size="sm"
        ><Badge variant="outline">1</Badge>nerve</Button
      >
      <Button variant="ghost" size="sm">PPlied</Button>
    {/snippet}
    {#snippet actions()}
      <Badge variant="outline" class="font-mono">v0.34.1</Badge>
      <Button variant="ghost" size="icon" ariaLabel="Discover"
        ><CompassIcon /></Button
      >
      <Button variant="ghost" size="icon" ariaLabel="Logs"><ListIcon /></Button>
      <Button variant="ghost" size="icon" ariaLabel="Settings"
        ><SettingsIcon /></Button
      >
    {/snippet}
  </ShellTitlebar>
{/snippet}

{#snippet statusBarMock()}
  <ShellStatusBar toggles={dockToggles}>
    {#snippet left()}
      <span class={STATUS_BAR_CHIP}
        ><FolderIcon class="size-3" aria-hidden="true" />~/Projects/nerve</span
      >
      <span class={STATUS_BAR_CHIP}
        ><GitBranchIcon
          class="size-3"
          aria-hidden="true"
        />fix/retain-resolved-plan-review-cards</span
      >
      <span class={STATUS_BAR_CHIP}>± 28</span>
    {/snippet}
    {#snippet right()}
      <PopoverPanel
        size="md"
        side="top"
        align="end"
        ariaLabel="Subscription usage"
        triggerClass={STATUS_BAR_CHIP_BUTTON}
      >
        {#snippet trigger()}Codex 22% 5d 15h{/snippet}
        {@render usagePanel()}
      </PopoverPanel>
      <PopoverPanel
        size="md"
        side="top"
        align="end"
        ariaLabel="Layout"
        triggerClass={STATUS_BAR_CHIP_BUTTON}
      >
        {#snippet trigger()}100%{/snippet}
        {@render layoutPanel()}
      </PopoverPanel>
      <PopoverPanel
        size="sm"
        side="top"
        align="end"
        ariaLabel="Daemon status"
        triggerClass={STATUS_BAR_CHIP_BUTTON}
      >
        {#snippet trigger()}
          <StatusDot tone="success" size="xs" />Connected
        {/snippet}
        {@render daemonPanel()}
      </PopoverPanel>
    {/snippet}
  </ShellStatusBar>
{/snippet}

{#snippet usagePanel()}
  <PopoverHeader title="Subscription usage" meta="Updated 07:28 PM" />
  <PopoverBody>
    <PopoverSection label="Anthropic">
      <PopoverMeter
        label="Session"
        value="38%"
        percent={38}
        caption="resets in 4h"
      />
      <PopoverMeter
        label="Weekly"
        value="21%"
        percent={21}
        caption="resets in 5d 11h"
      />
    </PopoverSection>
    <PopoverSection label="Codex · prolite" separated>
      {#snippet action()}<Badge variant="outline">Active</Badge>{/snippet}
      <PopoverMeter
        label="Weekly"
        value="22%"
        percent={22}
        caption="resets in 5d 15h"
      />
    </PopoverSection>
  </PopoverBody>
{/snippet}

{#snippet layoutPanel()}
  <PopoverHeader title="Layout" meta="Zoom 100%" />
  <PopoverBody>
    <PopoverSection label="Panels">
      <PopoverProperties>
        <PopoverProperty label="Left Panel" value="Ctrl+B" />
        <PopoverProperty label="Right Panel" value="Ctrl+Alt+B" />
      </PopoverProperties>
    </PopoverSection>
  </PopoverBody>
{/snippet}

{#snippet daemonPanel()}
  <PopoverHeader title="Nerve daemon" meta="v0.34.1" />
  <PopoverBody>
    <PopoverProperties>
      <PopoverProperty label="Uptime" value="1h 26m" />
      <PopoverProperty label="Index">
        <Badge variant="success">Healthy</Badge>
      </PopoverProperty>
      <PopoverProperty
        label="Data dir"
        value="/home/tlm/Projects/nerve/data/storage-1"
        title="Data directory"
      />
    </PopoverProperties>
  </PopoverBody>
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
    <div class="p-3 text-xs text-muted-foreground">
      Panel body for “{viewId}”. See the Panels page for real content.
    </div>
  {/if}
{/snippet}
