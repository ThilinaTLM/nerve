<script lang="ts">
import type { ConversationSummary } from "@nervekit/contracts/core";
import ConversationListItem from "$lib/presentation/conversations/ConversationListItem.svelte";
import ConversationActivityIndicator from "$lib/presentation/conversations/ConversationActivityIndicator.svelte";
import {
  idleConversationActivity,
  type ConversationActivity,
} from "$lib/presentation/conversations/conversation-activity";
import NotificationEntry from "$lib/presentation/activity/NotificationEntry.svelte";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import ArchiveIcon from "@lucide/svelte/icons/archive";
import ArrowDownToLineIcon from "@lucide/svelte/icons/arrow-down-to-line";
import BookmarkIcon from "@lucide/svelte/icons/bookmark";
import CloudDownloadIcon from "@lucide/svelte/icons/cloud-download";
import FileIcon from "@lucide/svelte/icons/file";
import FileCodeIcon from "@lucide/svelte/icons/file-code";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import PencilIcon from "@lucide/svelte/icons/pencil";
import PlusIcon from "@lucide/svelte/icons/plus";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import SquarePenIcon from "@lucide/svelte/icons/square-pen";
import StickyNoteIcon from "@lucide/svelte/icons/sticky-note";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import XIcon from "@lucide/svelte/icons/x";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { ItemSurface } from "$lib/presentation/items";
import {
  PanelCard,
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelRow,
  PanelRowCard,
  PanelSectionHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
  buildPanelTree,
} from "$lib/presentation/panels";
import GitPanel from "$lib/features/git/views/GitPanel.svelte";
import PullRequestsPanel from "$lib/features/git/views/PullRequestsPanel.svelte";
import LaunchesPanel from "$lib/features/launches/views/LaunchesPanel.svelte";
import ProjectConversationNavigator from "$lib/features/projects/views/ProjectConversationNavigator.svelte";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";
import {
  conversationNavigatorProps,
  gitActions,
  gitChangesModel,
  launchPanelActions,
  launchPanelModel,
  navigatorSelectedConversationId,
  pullRequestsModel,
} from "./panels-fixtures";

const longLabel =
  "packages/workbench-app/src/lib/presentation/transcript/components/a-very-long-component-name.svelte";

const menuItems: ContextMenuItem[] = [
  { type: "item", label: "Open", icon: FileIcon },
  { type: "item", label: "Rename", icon: PencilIcon, shortcut: "F2" },
  { type: "separator" },
  { type: "item", label: "Delete", icon: Trash2Icon, destructive: true },
];

let selectedRow = $state("second");
let loadingRefresh = $state(true);
let titleEditing = $state(false);
let selectedConversationId = $state(navigatorSelectedConversationId);

// ── Sample data ──────────────────────────────────────────────────────────
type FileItem = { path: string[]; change?: "M" | "A" | "D" };

const projectFiles: FileItem[] = [
  { path: [".github", "workflows", "ci.yml"] },
  { path: [".nerve", "skills", "nerve-debug", "SKILL.md"] },
  { path: ["docs", "architecture.md"] },
  { path: ["packages", "workbench-app", "src", "main.ts"] },
  { path: ["packages", "ui-kit", "src", "index.ts"] },
  { path: ["scripts", "dev.mjs"] },
  { path: ["AGENTS.md"] },
  { path: ["Cargo.toml"] },
  { path: ["README.md"] },
  { path: ["package.json"] },
  { path: ["tsconfig.json"] },
];
const stagedFiles: FileItem[] = [
  {
    path: [
      "packages/workbench-app/src",
      "lib/app/gallery",
      "sections",
      "ButtonsSection.svelte",
    ],
    change: "A",
  },
  {
    path: [
      "packages/workbench-app/src",
      "lib/app/gallery",
      "sections",
      "CodeSection.svelte",
    ],
    change: "A",
  },
  {
    path: [
      "packages/workbench-app/src",
      "lib/app/gallery",
      "sections",
      "PanelsSection.svelte",
    ],
    change: "M",
  },
  {
    path: [
      "packages/workbench-app/src",
      "lib/app/gallery",
      "sections",
      "legacy.svelte",
    ],
    change: "D",
  },
  {
    path: [
      "packages/workbench-app/src",
      "lib/app/gallery",
      "gallery-sections.ts",
    ],
    change: "A",
  },
  { path: ["packages/workbench-app/src", "App.svelte"], change: "M" },
];
const pathOptions = {
  getPath: (item: FileItem) => item.path,
  getKey: (item: FileItem) => item.path.join("/"),
};
const fileNodes = buildPanelTree(projectFiles, pathOptions);
const stagedNodes = buildPanelTree(stagedFiles, pathOptions);

const changeTone: Record<NonNullable<FileItem["change"]>, StatusTone> = {
  M: "warning",
  A: "success",
  D: "destructive",
};

function fileIcon(item: FileItem) {
  const name = item.path.at(-1) ?? "";
  if (name.endsWith(".svelte") || name.endsWith(".ts")) return FileCodeIcon;
  if (name.endsWith(".md")) return FileTextIcon;
  return FileIcon;
}

const sampleConversation: ConversationSummary = {
  id: "gallery",
  projectId: "project",
  parentConversationId: null,
  parentToolCallId: null,
  title: "Review design-system cleanup",
  status: "idle",
  statusClearedAt: null,
  paused: false,
  pinnedAt: null,
  completedAt: null,
  lastUserMessageAt: null,
  createdAt: "2026-10-14T09:30:00.000Z",
  updatedAt: "2026-10-14T09:30:00.000Z",
  references: [],
  childCount: 0,
  pendingWork: false,
  pendingInput: null,
};
const activityExamples: {
  label: string;
  open: boolean;
  activity: ConversationActivity;
}[] = [
  ["idle open", "idle", "neutral", true],
  ["idle closed", "idle", "neutral", false],
  ["running", "running", "info", true],
  ["result-ready", "result-ready", "success", true],
  ["needs-user", "needs-user", "warning", true],
  ["error", "error", "destructive", true],
  ["completed", "completed", "neutral", true],
  ["aborted", "aborted", "neutral", true],
  ["awaiting-async", "awaiting-async", "warning", true],
].map(([label, indicator, tone, open]) => ({
  label: String(label),
  open: Boolean(open),
  activity: {
    ...idleConversationActivity,
    indicator: indicator as ConversationActivity["indicator"],
    tone: tone as StatusTone,
    label: String(label),
    busy: indicator === "running",
    pulse: indicator === "running",
  },
}));
</script>

{#snippet rowActions()}
  <PanelToolbarButton icon={PencilIcon} label="Rename" dense />
  <PanelToolbarButton icon={Trash2Icon} label="Delete" dense />
{/snippet}

{#snippet fileLeading(item: FileItem)}
  {@const Icon = fileIcon(item)}
  <Icon class="size-3.5" aria-hidden="true" />
{/snippet}

{#snippet changeLeading(item: FileItem)}
  <span class="w-3 flex-none text-center text-ui font-semibold"
    >{item.change}</span
  >
{/snippet}

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="The real dock panel views, fed with local mock data, at the 280px dock width on the panel surface."
  >
    <GallerySpecimen
      title="Dock panels at 280px"
      source="features/*/views"
      usage="ProjectConversationNavigator · GitPanel · PullRequestsPanel · LaunchesPanel"
      surface="panel"
      layout="bare"
      description="Production views with mock models; actions are no-ops. Click a conversation to move the selection."
    >
      <div class="flex flex-wrap items-start gap-6">
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <ProjectConversationNavigator
            {...conversationNavigatorProps}
            {selectedConversationId}
            onOpenConversation={(id) => (selectedConversationId = id)}
          />
        </div>
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <GitPanel model={gitChangesModel} actions={gitActions} />
        </div>
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <PullRequestsPanel model={pullRequestsModel} actions={gitActions} />
        </div>
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <LaunchesPanel
            model={launchPanelModel}
            actions={launchPanelActions}
          />
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Dock panels without a stateless view"
      source="panels/*"
      usage="FilesPanelHost · NotesPanel"
      surface="panel"
      layout="bare"
      description="Files and Notes still read app stores and load data on mount, so these are composed from panel kit components until each splits into a stateless view and a host."
    >
      <div class="flex flex-wrap items-start gap-6">
        <!-- Files -->
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <PanelView>
            {#snippet banner()}
              <PanelHeader title="Files" count={33}>
                {#snippet trailing()}
                  <PanelToolbarButton
                    icon={RefreshCwIcon}
                    label="Refresh files"
                  />
                {/snippet}
              </PanelHeader>
            {/snippet}
            <div class="min-h-0 flex-1 overflow-y-auto">
              <PanelTree
                nodes={fileNodes}
                ariaLabel="Workspace files"
                itemLeading={fileLeading}
                getItemMenuItems={() => menuItems}
              />
            </div>
          </PanelView>
        </div>

        <!-- Scratch notes (empty) -->
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <PanelView>
            {#snippet banner()}
              <PanelHeader title="Notes" count={0}>
                {#snippet trailing()}
                  <PanelToolbarButton icon={PlusIcon} label="Add note" />
                {/snippet}
              </PanelHeader>
            {/snippet}
            <PanelEmpty
              icon={SquarePenIcon}
              title="No scratch notes yet"
              description="Notes are scoped to this project."
            >
              {#snippet action()}
                <Button variant="outline" size="sm">
                  <PlusIcon data-icon="inline-start" />
                  New note
                </Button>
              {/snippet}
            </PanelEmpty>
          </PanelView>
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Frame & toolbar"
    description="Every panel is a PanelView with a PanelHeader in the banner slot."
  >
    <GallerySpecimen
      title="PanelHeader"
      source="panels/PanelHeader"
      usage="6 files · git, editor, projects, notes, launches"
      surface="card"
      layout="stack"
      description="Title, count, optional trailing icon actions; truncates long titles."
    >
      <div class="w-70 max-w-full">
        <PanelHeader title="Conversations" count={158} />
        <PanelHeader title="Notes" count={0}>
          {#snippet trailing()}
            <PanelToolbarButton icon={PlusIcon} label="Add note" />
          {/snippet}
        </PanelHeader>
        <PanelHeader
          title="A very long panel title that has to truncate before the actions"
          count={128}
        >
          {#snippet trailing()}
            <PanelToolbarButton icon={RefreshCwIcon} label="Refresh" />
          {/snippet}
        </PanelHeader>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="PanelToolbarButton"
      source="panels/PanelToolbarButton"
      usage="10 files · git, launches, notes, editor, projects"
      surface="card"
      description="Icon-only ghost (default and dense), loading, disabled; and outline with showLabel. Hover for the tooltip title."
    >
      <PanelToolbarButton icon={PlusIcon} label="Default" />
      <PanelToolbarButton icon={PlusIcon} label="Dense" dense />
      <PanelToolbarButton
        icon={RefreshCwIcon}
        label="Loading"
        loading={loadingRefresh}
        onclick={() => (loadingRefresh = !loadingRefresh)}
      />
      <PanelToolbarButton icon={PlusIcon} label="Disabled" disabled />
      <PanelToolbarButton
        icon={ArchiveIcon}
        label="Stashes"
        variant="outline"
        showLabel
      >
        {#snippet badge()}
          <Badge variant="neutral">1</Badge>
        {/snippet}
      </PanelToolbarButton>
      <PanelToolbarButton
        icon={CloudDownloadIcon}
        label="Fetch"
        variant="outline"
        showLabel
      />
      <PanelToolbarButton
        icon={RefreshCwIcon}
        label="Sync"
        variant="outline"
        showLabel
        loading
      />
      <PanelToolbarButton
        icon={PlusIcon}
        label="Disabled"
        variant="outline"
        showLabel
        disabled
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="PanelSectionHeader"
      source="panels/PanelSectionHeader"
      usage="2 files · projects, launches"
      surface="card"
      layout="stack"
      description="Static group heading (date groups, Runs); sticky within the scroll region."
    >
      <div class="w-70 max-w-full">
        <PanelSectionHeader title="Today" count={11} />
        <PanelSectionHeader title="Runs" count={3}>
          {#snippet actions()}
            <PanelToolbarButton icon={Trash2Icon} label="Prune history" dense />
          {/snippet}
        </PanelSectionHeader>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Rows"
    description="PanelRow is the base row of every panel. Selection uses bg-selected."
  >
    <GallerySpecimen
      title="PanelRow — tone, state, mono, dense, indent"
      source="panels/PanelRow"
      usage="5 files · launches, panels, git, projects"
      surface="card"
      layout="stack"
      description="Tone (git change colours), active, selected, mono labels, dense (20px) rows and indent steps."
    >
      <div class="grid gap-6 md:grid-cols-2">
        <PanelList ariaLabel="States" class="w-70 max-w-full">
          <PanelRow label="Default" />
          <PanelRow label="Warning (modified)" tone="warning" />
          <PanelRow label="Success (added)" tone="success" />
          <PanelRow label="Destructive (deleted)" tone="destructive" />
          <PanelRow label="Active" active />
          <PanelRow label="Selected" selected />
          <PanelRow label="Disabled" disabled />
          <PanelRow label="Mono label" mono />
        </PanelList>
        <PanelList ariaLabel="Dense and indent" class="w-70 max-w-full">
          <PanelRow dense label="dense row" />
          <PanelRow dense label="dense + indent 1" indent={1} />
          <PanelRow dense label="dense + indent 2" indent={2} />
          <PanelRow label="default row" description="28px" />
          <PanelRow
            labelLines={2}
            label="Two-line label that wraps onto a second line when it is long enough to need it"
          />
          <PanelRow label={longLabel} />
        </PanelList>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="PanelRow — menu and actions"
      source="panels/PanelRow"
      usage="5 files · launches, panels, git, projects"
      surface="card"
      layout="stack"
      description="Right-click for menuItems; actions are hidden until hover/focus unless alwaysShowActions."
    >
      <PanelList ariaLabel="Menu and actions" class="w-70 max-w-full">
        {#each ["first", "second", "third"] as id (id)}
          <PanelRow
            label="Row {id}"
            selected={selectedRow === id}
            {menuItems}
            onclick={() => (selectedRow = id)}
          />
        {/each}
        <PanelRow label="Hover to reveal actions" actions={rowActions} />
        <PanelRow
          dense
          label="Always show actions"
          alwaysShowActions
          actions={rowActions}
        />
      </PanelList>
    </GallerySpecimen>

    <GallerySpecimen
      title="PanelRowCard + ItemSurface (row)"
      source="panels/PanelRowCard"
      usage="3 files · launches, projects (ItemSurface: 7 files · git, projects, panels)"
      surface="card"
      layout="stack"
      description="PanelRowCard wraps rows in the ItemSurface 'row' tone; selected adds the selection treatment. ItemSurface tone='row' with hover default/soft is also used directly for pull-request rows."
    >
      <div class="grid w-70 max-w-full gap-1.5">
        <PanelRowCard>
          <PanelRow
            hoverable={false}
            label="Default card"
            description="Wraps rows"
          />
        </PanelRowCard>
        <PanelRowCard selected {menuItems}>
          <PanelRow
            hoverable={false}
            label="Selected card"
            description="aria-current list item"
          />
        </PanelRowCard>
        <ItemSurface
          tone="row"
          hover="default"
          class="flex-col gap-1 px-3 py-2.5"
          role="listitem"
        >
          <span class="truncate text-ui">Fix plan review body and footer</span>
          <span class="truncate text-ui text-muted-foreground"
            >#423 · fix/retain-resolved-plan-review-cards</span
          >
        </ItemSurface>
        <ItemSurface
          tone="row"
          hover="soft"
          selected
          class="flex-col gap-1 px-3 py-2.5"
          role="listitem"
        >
          <span class="truncate text-ui">Selected surface</span>
          <span class="truncate text-ui text-muted-foreground">#421 · main</span
          >
        </ItemSurface>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="PanelCard"
      source="panels/PanelCard"
      usage="1 file · notes"
      surface="card"
      layout="stack"
      description="Scratch-note card: editable title (double-click), meta and actions."
    >
      <div class="grid w-70 max-w-full gap-2">
        <PanelCard
          title={titleEditing ? "Rename me" : "Release checklist"}
          titleHint="Double-click to rename"
          {titleEditing}
          onTitleDblClick={() => (titleEditing = true)}
          onTitleCommit={() => (titleEditing = false)}
          onTitleCancel={() => (titleEditing = false)}
          icon={StickyNoteIcon}
        >
          {#snippet meta()}
            <span>2m ago</span>
          {/snippet}
          {#snippet actions()}
            <IconAction
              icon={Trash2Icon}
              label="Delete note"
              tone="destructive"
            />
          {/snippet}
          <p class="px-3 pb-2 text-ui text-muted-foreground">
            Verify migrations, then tag the release.
          </p>
        </PanelCard>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="PanelList + PanelTree"
      source="panels/PanelTree"
      usage="PanelList 5 files · git, launches, projects, dialogs; PanelTree 3 files · git, editor"
      surface="card"
      layout="bare"
      description="Keyboard-navigable tree: tone, selection, menu, item/group actions, and without disclosure arrows (folder icon carries state)."
    >
      <div class="flex flex-wrap items-start gap-6">
        <div class="w-70 max-w-full">
          <PanelTree
            nodes={stagedNodes}
            ariaLabel="Changes"
            itemLeading={changeLeading}
            getItemTone={(item) =>
              item.change ? changeTone[item.change] : undefined}
            getItemSelected={(item) =>
              item.path.at(-1) === "PanelsSection.svelte"}
            getItemMenuItems={() => menuItems}
          >
            {#snippet itemActions()}
              <PanelToolbarButton icon={XIcon} label="Discard" dense />
            {/snippet}
            {#snippet groupActions()}
              <PanelToolbarButton
                icon={ArrowDownToLineIcon}
                label="Unstage folder"
                dense
              />
            {/snippet}
          </PanelTree>
        </div>
        <div class="w-70 max-w-full">
          <PanelTree
            nodes={fileNodes}
            ariaLabel="Files without arrows"
            showGroupDisclosure={false}
            itemLeading={fileLeading}
          />
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Banners & empty states">
    <GallerySpecimen
      title="PanelEmpty"
      source="panels/PanelEmpty"
      usage="4 files · editor, projects, notes, launches"
      surface="card"
      layout="bare"
      description="Empty and error states: no project, empty project, no notes, no launches."
    >
      <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <PanelEmpty
          icon={FileIcon}
          title="No project selected"
          description="Select a project to browse its files."
        />
        <PanelEmpty icon={TriangleAlertIcon} title="Could not load files">
          {#snippet action()}
            <Button variant="outline" size="sm">Retry</Button>
          {/snippet}
        </PanelEmpty>
        <PanelEmpty
          icon={SquarePenIcon}
          title="No scratch notes yet"
          description="Notes are scoped to this project."
        />
        <PanelEmpty
          icon={BookmarkIcon}
          title="No launch configurations yet"
          description="Create a launch configuration to run it anytime."
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>
  <GalleryGroup title="Shared presentation">
    <GallerySpecimen
      title="ConversationListItem"
      source="presentation/conversations/ConversationListItem.svelte"
      layout="stack"
    >
      {#each ["idle", "selected", "running"] as state (state)}
        <ConversationListItem
          conversation={{
            ...sampleConversation,
            id: state,
            title:
              state === "running"
                ? "Investigate reconnect failure"
                : "Review design-system cleanup",
          }}
          isActive={state === "selected"}
          isOpen={state !== "idle"}
          activity={state === "running"
            ? activityExamples[2].activity
            : idleConversationActivity}
          onOpenConversation={() => {}}
        />
      {/each}
    </GallerySpecimen>
    <GallerySpecimen
      title="ConversationActivityIndicator"
      source="presentation/conversations/ConversationActivityIndicator.svelte"
      layout="stack"
    >
      {#each activityExamples as example (example.label)}
        <div class="flex items-center gap-3 text-ui text-foreground">
          <ConversationActivityIndicator
            activity={example.activity}
            variant="rail"
            isOpen={example.open}
          />{example.label}
        </div>
      {/each}
    </GallerySpecimen>
    <GallerySpecimen
      title="NotificationEntry"
      source="presentation/activity/NotificationEntry.svelte"
      layout="stack"
    >
      <NotificationEntry
        tone="succeeded"
        title="Review complete"
        context="Design-system cleanup"
        time="2m"
        unread
        interactive
        actions={[{ label: "Open conversation", onSelect: () => {} }]}
      />
      <NotificationEntry
        tone="running"
        title="Running unit tests"
        progress={65}
      />
      <NotificationEntry
        tone="failed"
        title="Build failed"
        detail="Cannot resolve the selected provider."
        actions={[
          { label: "Retry", onSelect: () => {} },
          { label: "View logs", onSelect: () => {}, disabled: true },
        ]}
      />
    </GallerySpecimen>
  </GalleryGroup>
</div>
