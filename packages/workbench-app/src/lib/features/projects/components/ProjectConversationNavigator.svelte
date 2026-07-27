<script lang="ts">
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { PanelEmpty, PanelList, PanelView } from "@nervekit/workbench-ui/panel";
import { buildConversationRows } from "$lib/core/utils/project-tree";
import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
import { getShortcutLabel } from "$lib/core/shortcuts/registry";
import {
  buildConversationMenu,
  type ProjectTreeMenuContext,
} from "./project-tree-menus";
import type {
  DeleteTarget,
  ProjectAgentTreeProps,
} from "./project-agent-tree-props";

let {
  projects = [],
  conversations = [],
  agents = [],
  selectedProjectId,
  selectedConversationId,
  openConversationTabIds,
  conversationActivityById = {},
  searchFocusToken = 0,
  editorAvailability,
  homeDir,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onDeleteConversation,
  onPruneProjectConversations,
}: ProjectAgentTreeProps = $props();

let pendingDelete = $state<DeleteTarget | undefined>();
let allConversationsOpen = $state(false);
let listRegion = $state<HTMLDivElement | null>(null);
let listFooter = $state<HTMLDivElement | null>(null);
let visibleCount = $state(Number.MAX_SAFE_INTEGER);
let measuredRowHeight = 0;
let measureFrame: number | undefined;

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const rows = $derived(
  buildConversationRows({ conversations, agents, projectIds }),
);
const visibleRows = $derived(rows.slice(0, visibleCount));
const hasHiddenRows = $derived(visibleRows.length < rows.length);
const newConversationShortcut = getShortcutLabel("conversation.new");
const switchProjectShortcut = getShortcutLabel("conversation.newFromProject");
const emptyStateHint = switchProjectShortcut
  ? `Use the folder button in the header (${switchProjectShortcut}) to get started.`
  : "Use the folder button in the header to get started.";

function measureVisibleCount(): void {
  if (!listRegion) return;
  const list = listRegion.querySelector<HTMLElement>("[role='list']");
  const row = list?.querySelector<HTMLElement>(".panel-row");
  if (row) measuredRowHeight = row.getBoundingClientRect().height;
  if (!list || measuredRowHeight <= 0) return;

  const listStyle = getComputedStyle(list);
  const listPadding =
    Number.parseFloat(listStyle.paddingTop) +
    Number.parseFloat(listStyle.paddingBottom);
  const footerHeight = listFooter?.getBoundingClientRect().height ?? 0;
  const availableHeight =
    listRegion.getBoundingClientRect().height - footerHeight - listPadding;
  // Allow a small subpixel tolerance so app zoom and rem rounding do not
  // unnecessarily leave room for an additional complete row.
  const nextCount = Math.max(
    0,
    Math.floor((availableHeight + 2) / measuredRowHeight),
  );
  if (nextCount !== visibleCount) visibleCount = nextCount;
}

function scheduleMeasurement(): void {
  if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(() => {
    measureFrame = undefined;
    measureVisibleCount();
  });
}

$effect(() => {
  if (!listRegion || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(scheduleMeasurement);
  observer.observe(listRegion);
  scheduleMeasurement();
  return () => {
    observer.disconnect();
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
  };
});

$effect(() => {
  const rowCount = rows.length;
  const footer = listFooter;
  queueMicrotask(() => {
    if (rowCount === rows.length && footer === listFooter)
      scheduleMeasurement();
  });
});

let lastSearchFocusToken = 0;
$effect(() => {
  if (searchFocusToken === lastSearchFocusToken) return;
  lastSearchFocusToken = searchFocusToken;
  allConversationsOpen = true;
});

const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir,
  newConversationShortcut,
  editorAvailability,
  conversationCount: (projectId) =>
    conversations.filter((conversation) => conversation.projectId === projectId)
      .length,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  requestPrune: (project: ProjectRecord) =>
    onPruneProjectConversations?.(project.id, {
      strategy: "keepLatest",
      keepLatest: 20,
    }),
  requestDelete: (target) => (pendingDelete = target),
});
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <PanelView padded={false} scroll={false}>
    {#if !activeProject}
      <PanelEmpty title="No project selected." description={emptyStateHint} />
    {:else if rows.length === 0}
      <PanelEmpty title="No conversations in this project yet.">
        {#snippet action()}
          <Button
            variant="outline"
            size="sm"
            onclick={() => onNewConversationInProject?.(activeProject.dir)}
            >New chat</Button
          >
        {/snippet}
      </PanelEmpty>
    {:else}
      <div
        bind:this={listRegion}
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <PanelList ariaLabel="Conversations" class="shrink-0 py-1">
          {#each visibleRows as row (row.conversation.id)}
            {@const rowProject =
              projects.find(
                (project) => project.id === row.conversation.projectId,
              ) ?? activeProject}
            <ProjectAgentTreeNode
              {row}
              isOpen={openConversationTabIds?.has(row.conversation.id) ?? false}
              isActive={row.conversation.id === selectedConversationId}
              activity={conversationActivityById[row.conversation.id]}
              menuItems={buildConversationMenu(
                rowProject,
                row.conversation,
                menuContext,
              )}
              {onOpenConversation}
            />
          {/each}
        </PanelList>
        {#if hasHiddenRows}
          <div bind:this={listFooter} class="mt-auto shrink-0 p-1">
            <Button
              variant="ghost"
              size="xs"
              class="w-full text-muted-foreground"
              onclick={() => (allConversationsOpen = true)}>See More</Button
            >
          </div>
        {/if}
      </div>
    {/if}
  </PanelView>
</Tooltip.Provider>

<AlertDialog
  open={pendingDelete?.kind === "conversation"}
  title="Delete conversation?"
  description={pendingDelete
    ? `This permanently removes “${pendingDelete.label}”.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (pendingDelete?.kind === "conversation")
      onDeleteConversation?.(pendingDelete.id);
  }}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>

{#if activeProject}
  <ProjectConversationsDialog
    open={allConversationsOpen}
    projectLabel={activeProject.name}
    project={activeProject}
    {projectIds}
    {conversations}
    {agents}
    {selectedConversationId}
    {openConversationTabIds}
    {conversationActivityById}
    {onOpenConversation}
    buildMenu={(conversation) =>
      buildConversationMenu(
        projects.find((project) => project.id === conversation.projectId) ??
          activeProject,
        conversation,
        menuContext,
      )}
    onOpenChange={(open) => (allConversationsOpen = open)}
  />
{/if}
