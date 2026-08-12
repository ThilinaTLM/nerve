<script lang="ts">
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Plus from "@lucide/svelte/icons/plus";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelScrollRegion,
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
      <PanelEmpty
        icon={MessagesSquare}
        title="No conversations yet"
        description="Conversations are scoped to this project."
      >
        {#snippet action()}
          <Button
            variant="outline"
            size="xs"
            onclick={() => onNewConversationInProject?.(activeProject.dir)}
          >
            <Plus />
            New chat
          </Button>
        {/snippet}
      </PanelEmpty>
    {:else}
      <PanelScrollRegion
        ariaLabel="Conversations"
        activeKey={selectedConversationId}
      >
        <PanelList ariaLabel="Conversations" class="shrink-0 gap-1 pt-1 pb-0">
          {#each displayedRows as row (row.conversation.id)}
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
      </PanelScrollRegion>
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
