<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panel";
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

const MAX_LISTED_CONVERSATIONS = 100;

let pendingDelete = $state<DeleteTarget | undefined>();
let allConversationsOpen = $state(false);
let listRegion = $state<HTMLDivElement | null>(null);
let canScrollUp = $state(false);
let canScrollDown = $state(false);

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const rows = $derived(
  buildConversationRows({ conversations, agents, projectIds }),
);
const displayedRows = $derived(rows.slice(0, MAX_LISTED_CONVERSATIONS));
const newConversationShortcut = getShortcutLabel("conversation.new");
const switchProjectShortcut = getShortcutLabel("conversation.newFromProject");
const emptyStateHint = switchProjectShortcut
  ? `Use the folder button in the header (${switchProjectShortcut}) to get started.`
  : "Use the folder button in the header to get started.";

let lastSearchFocusToken = 0;
$effect(() => {
  if (searchFocusToken === lastSearchFocusToken) return;
  lastSearchFocusToken = searchFocusToken;
  allConversationsOpen = true;
});

function updateScrollShadows(): void {
  const region = listRegion;
  if (!region) return;
  canScrollUp = region.scrollTop > 2;
  canScrollDown =
    region.scrollTop + region.clientHeight < region.scrollHeight - 2;
}

$effect(() => {
  const region = listRegion;
  if (!region) return;
  updateScrollShadows();
  region.addEventListener("scroll", updateScrollShadows, { passive: true });
  const observer = new ResizeObserver(updateScrollShadows);
  observer.observe(region);
  const content = region.firstElementChild;
  if (content) observer.observe(content); // row count changes resize the list
  return () => {
    region.removeEventListener("scroll", updateScrollShadows);
    observer.disconnect();
  };
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
    <PanelHeader title="Conversations" count={rows.length}>
      {#snippet trailing()}
        <span class="inline-flex" data-tour-id="panel-new-conversation">
          <PanelToolbarButton
            icon={Plus}
            label="New chat"
            title={newConversationShortcut
              ? `New chat (${newConversationShortcut})`
              : "New chat"}
            disabled={!activeProject || !onNewConversationInProject}
            onclick={() => {
              if (activeProject)
                onNewConversationInProject?.(activeProject.dir);
            }}
          />
        </span>
      {/snippet}
    </PanelHeader>

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
      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          bind:this={listRegion}
          class="conversation-list-scroller min-h-0 flex-1 overflow-y-auto"
          onscroll={updateScrollShadows}
        >
          <PanelList ariaLabel="Conversations" class="shrink-0 gap-1 pt-1 pb-0">
            {#each displayedRows as row (row.conversation.id)}
              {@const rowProject =
                projects.find(
                  (project) => project.id === row.conversation.projectId,
                ) ?? activeProject}
              <ProjectAgentTreeNode
                {row}
                isOpen={openConversationTabIds?.has(row.conversation.id) ??
                  false}
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
        </div>
        <div
          class="conversation-list-shadow conversation-list-shadow-top pointer-events-none absolute inset-x-0 top-0 h-6 opacity-0 transition-opacity duration-150"
          class:opacity-100={canScrollUp}
        ></div>
        <div
          class="conversation-list-shadow conversation-list-shadow-bottom pointer-events-none absolute inset-x-0 bottom-0 h-6 opacity-0 transition-opacity duration-150"
          class:opacity-100={canScrollDown}
        ></div>
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

<style>
/* Escape-hatch reason 2: the native scrollbar is hidden; the edge shadows
   * below are the scroll affordance. */
.conversation-list-scroller {
  scrollbar-width: none;
}

.conversation-list-scroller::-webkit-scrollbar {
  display: none;
}

/* Edge shadows are gradients (not expressible as utilities). They blend the
   * list into the panel's own background color, so rows appear to slide
   * under the panel surface where more content is waiting. */
.conversation-list-shadow-bottom {
  background: linear-gradient(
    to top,
    var(--card) 0%,
    var(--card) 22%,
    transparent 72%
  );
}

.conversation-list-shadow-top {
  background: linear-gradient(
    to bottom,
    var(--card) 0%,
    var(--card) 22%,
    transparent 72%
  );
}
</style>
