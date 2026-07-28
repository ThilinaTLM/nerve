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
  createPanelRowFit,
} from "@nervekit/workbench-ui/panel";
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

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const rows = $derived(
  buildConversationRows({ conversations, agents, projectIds }),
);
const rowFit = createPanelRowFit({
  region: () => listRegion,
  footer: () => listFooter,
  total: () => rows.length,
});
const visibleRows = $derived(rows.slice(0, rowFit.count));
const hasHiddenRows = $derived(visibleRows.length < rows.length);
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
        <PanelToolbarButton
          icon={Plus}
          label="New chat"
          title={newConversationShortcut
            ? `New chat (${newConversationShortcut})`
            : "New chat"}
          disabled={!activeProject || !onNewConversationInProject}
          onclick={() => {
            if (activeProject) onNewConversationInProject?.(activeProject.dir);
          }}
        />
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
