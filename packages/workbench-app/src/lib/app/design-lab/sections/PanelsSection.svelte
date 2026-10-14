<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import ArchiveIcon from "@lucide/svelte/icons/archive";
import ArrowDownToLineIcon from "@lucide/svelte/icons/arrow-down-to-line";
import BookmarkIcon from "@lucide/svelte/icons/bookmark";
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
import CloudDownloadIcon from "@lucide/svelte/icons/cloud-download";
import FileIcon from "@lucide/svelte/icons/file";
import FileCodeIcon from "@lucide/svelte/icons/file-code";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import InfoIcon from "@lucide/svelte/icons/info";
import PencilIcon from "@lucide/svelte/icons/pencil";
import PlayIcon from "@lucide/svelte/icons/play";
import PlusIcon from "@lucide/svelte/icons/plus";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import SettingsIcon from "@lucide/svelte/icons/settings";
import SquareIcon from "@lucide/svelte/icons/square";
import SquarePenIcon from "@lucide/svelte/icons/square-pen";
import StickyNoteIcon from "@lucide/svelte/icons/sticky-note";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import XIcon from "@lucide/svelte/icons/x";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import { ItemSurface } from "$lib/presentation/items";
import {
  PanelBanner,
  PanelCard,
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelRow,
  PanelRowCard,
  PanelSectionHeader,
  PanelToolbar,
  PanelToolbarButton,
  PanelTree,
  PanelView,
  buildPanelTree,
} from "$lib/presentation/panels";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

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

type ConversationItem = {
  id: string;
  title: string;
  open?: boolean;
  tone?: StatusTone;
};
const conversationGroups: {
  title: string;
  count: number;
  items: ConversationItem[];
}[] = [
  {
    title: "Today",
    count: 11,
    items: [
      {
        id: "c1",
        title: "Basically, I want to polish the UX in our application",
      },
      { id: "c2", title: "Make sure both of them follows the same state" },
      {
        id: "c3",
        title:
          "The plan mode present tool view not showing the body and footer which was supposed to",
        open: true,
        tone: "info",
      },
      { id: "c4", title: "PR checks are failing can you fix it" },
    ],
  },
  {
    title: "Yesterday",
    count: 6,
    items: [
      {
        id: "c5",
        title:
          "Do you see the launch definition ID, or do you see the launch definition?",
      },
      { id: "c6", title: "Report me" },
    ],
  },
];
let selectedConversation = $state("c3");

type LaunchItem = { id: string; name: string; running?: boolean };
const launches: LaunchItem[] = [
  { id: "l1", name: "website" },
  { id: "l2", name: "workbench-ui", running: true },
  { id: "l3", name: "website-dev" },
  { id: "l4", name: "workbench-ui-dev" },
];
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
  <span class="w-3 flex-none text-center text-xs font-semibold"
    >{item.change}</span
  >
{/snippet}

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="The five left/right dock panels at their real 280px width, on the panel surface, modeled on the live-app screenshots and built only from panel kit components with static data."
  >
    <GallerySpecimen
      title="Dock panels at 280px"
      source="panels/*"
      usage="6 files · git, editor, projects, notes, launches"
      surface="panel"
      layout="bare"
    >
      <div class="flex flex-wrap items-start gap-6">
        <!-- Conversations -->
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <PanelView>
            {#snippet banner()}
              <PanelHeader title="Conversations" count={158}>
                {#snippet trailing()}
                  <PanelToolbarButton
                    icon={SettingsIcon}
                    label="Conversation settings"
                  />
                  <PanelToolbarButton icon={PlusIcon} label="New chat" />
                {/snippet}
              </PanelHeader>
            {/snippet}
            <div class="min-h-0 flex-1 overflow-y-auto">
              {#each conversationGroups as group (group.title)}
                <PanelSectionHeader title={group.title} count={group.count} />
                <PanelList ariaLabel={group.title}>
                  {#each group.items as item (item.id)}
                    <PanelRowCard
                      selected={selectedConversation === item.id}
                      {menuItems}
                      onclick={() => (selectedConversation = item.id)}
                    >
                      <PanelRow
                        label={item.title}
                        labelLines={2}
                        class="px-2"
                        active={selectedConversation === item.id}
                      >
                        {#snippet leading()}
                          <StatusDot
                            tone={item.tone ?? "neutral"}
                            size="md"
                            variant={item.open ? "solid" : "outline"}
                          />
                        {/snippet}
                      </PanelRow>
                    </PanelRowCard>
                  {/each}
                </PanelList>
              {/each}
            </div>
          </PanelView>
        </div>

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

        <!-- Git changes -->
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <PanelView>
            {#snippet banner()}
              <PanelHeader title="Git changes" count={28}>
                {#snippet trailing()}
                  <PanelToolbarButton
                    icon={RefreshCwIcon}
                    label="Refresh Git changes"
                  />
                {/snippet}
              </PanelHeader>
            {/snippet}
            <PanelRow label="fix/retain-resolved-plan-review-cards" mono>
              {#snippet leading()}
                <GitBranchIcon class="size-3.5" aria-hidden="true" />
              {/snippet}
              {#snippet actions()}
                <ChevronDownIcon class="size-3.5" aria-hidden="true" />
              {/snippet}
            </PanelRow>
            <PanelToolbar
              dense
              class="h-auto flex-wrap border-b-0 bg-transparent py-1.5"
            >
              <PanelToolbarButton
                icon={ArchiveIcon}
                label="Stashes (1)"
                variant="outline"
                showLabel
              />
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
              />
              <PanelToolbarButton
                icon={ArrowDownToLineIcon}
                label="main + pull"
                variant="outline"
                showLabel
              />
            </PanelToolbar>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <PanelRow dense label="Staged (28)" alwaysShowActions>
                {#snippet actions()}
                  <PanelToolbarButton
                    icon={ArrowDownToLineIcon}
                    label="Unstage all"
                    dense
                  />
                  <PanelToolbarButton icon={ArchiveIcon} label="Stash" dense />
                  <PanelToolbarButton icon={XIcon} label="Discard" dense />
                {/snippet}
              </PanelRow>
              <PanelTree
                nodes={stagedNodes}
                ariaLabel="Staged changes"
                itemLeading={changeLeading}
                getItemTone={(item) =>
                  item.change ? changeTone[item.change] : undefined}
                getItemMenuItems={() => menuItems}
              />
            </div>
          </PanelView>
        </div>

        <!-- Launches -->
        <div class="h-150 w-70 overflow-hidden rounded-md border">
          <PanelView>
            {#snippet banner()}
              <PanelHeader title="Launches" count={launches.length}>
                {#snippet trailing()}
                  <PanelToolbarButton icon={PlusIcon} label="Create launch" />
                {/snippet}
              </PanelHeader>
            {/snippet}
            <PanelList ariaLabel="Launches">
              {#each launches as launch (launch.id)}
                <PanelRow
                  label={launch.name}
                  tone={launch.running ? "success" : "neutral"}
                  alwaysShowActions
                >
                  {#snippet leading()}
                    {#if launch.running}
                      <StatusDot tone="success" size="md" variant="outline" />
                    {:else}
                      <BookmarkIcon class="size-3.5" aria-hidden="true" />
                    {/if}
                  {/snippet}
                  {#snippet actions()}
                    {#if launch.running}
                      <PanelToolbarButton
                        icon={RefreshCwIcon}
                        label="Restart launch"
                        dense
                      />
                      <PanelToolbarButton
                        icon={SquareIcon}
                        label="Stop launch"
                        dense
                      />
                    {:else}
                      <PanelToolbarButton
                        icon={PlayIcon}
                        label="Start launch"
                        dense
                      />
                    {/if}
                  {/snippet}
                </PanelRow>
              {/each}
            </PanelList>
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
      title="PanelToolbar"
      source="panels/PanelToolbar"
      usage="1 file · git"
      surface="card"
      layout="stack"
      description="Used once: dense, wrapping, no bottom border (Git Stashes/Fetch/Sync row)."
    >
      <div class="w-70 max-w-full">
        <PanelToolbar
          dense
          class="h-auto flex-wrap border-b-0 bg-transparent py-1.5"
        >
          <PanelToolbarButton
            icon={ArchiveIcon}
            label="Stashes (1)"
            variant="outline"
            showLabel
          />
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
          />
        </PanelToolbar>
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
          <PanelRow label="Default card" description="Wraps rows" />
        </PanelRowCard>
        <PanelRowCard selected {menuItems}>
          <PanelRow
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
          <span class="truncate text-sm">Fix plan review body and footer</span>
          <span class="truncate text-xs text-muted-foreground"
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
          <span class="truncate text-sm">Selected surface</span>
          <span class="truncate text-xs text-muted-foreground">#421 · main</span
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
          <p class="px-3 pb-2 text-xs text-muted-foreground">
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
      title="PanelBanner"
      source="panels/PanelBanner"
      usage="5 files · git, notes, launches, editor"
      surface="card"
      layout="stack"
      description="Pinned strip for panel-level status. Tones in use: neutral (6 sites), destructive (4), warning, info."
    >
      <div class="flex w-70 max-w-full flex-col gap-1">
        <PanelBanner tone="neutral">Everything is up to date</PanelBanner>
        <PanelBanner tone="info" icon={InfoIcon}>
          Indexing workspace…
          {#snippet actions()}
            <PanelToolbarButton icon={SquareIcon} label="Stop" dense />
          {/snippet}
        </PanelBanner>
        <PanelBanner tone="warning" icon={TriangleAlertIcon}>
          Working tree has uncommitted changes
        </PanelBanner>
        <PanelBanner tone="destructive" icon={CircleAlertIcon}>
          Failed to load files: connection refused
          {#snippet actions()}
            <PanelToolbarButton
              icon={RefreshCwIcon}
              label="Retry loading files"
              dense
            />
          {/snippet}
        </PanelBanner>
      </div>
    </GallerySpecimen>

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
</div>
