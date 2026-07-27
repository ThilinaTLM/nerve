<script lang="ts">
import List from "@lucide/svelte/icons/list";
import Plus from "@lucide/svelte/icons/plus";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  PanelEmpty,
  PanelList,
  PanelSearchInput,
  PanelToolbar,
  PanelToolbarButton,
  PanelToolbarGroup,
  PanelView,
} from "@nervekit/workbench-ui/panel";
import { buildConversationRows } from "$lib/core/utils/project-tree";
import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
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

let filter = $state("");
let searchInputEl = $state<HTMLInputElement | null>(null);
let pendingDelete = $state<DeleteTarget | undefined>();
let allConversationsOpen = $state(false);

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const rows = $derived(
  buildConversationRows({ conversations, agents, projectIds, filter }),
);
const searchShortcut = getShortcutLabel("projectSearch.focus");
const searchShortcutAria = getShortcutAriaLabel("projectSearch.focus");
const newConversationShortcut = getShortcutLabel("conversation.new");
const switchProjectShortcut = getShortcutLabel("conversation.newFromProject");
const emptyStateHint = switchProjectShortcut
  ? `Use the folder button in the header (${switchProjectShortcut}) to get started.`
  : "Use the folder button in the header to get started.";

let lastSearchFocusToken = 0;
$effect(() => {
  if (searchFocusToken === lastSearchFocusToken) return;
  lastSearchFocusToken = searchFocusToken;
  searchInputEl?.focus();
  searchInputEl?.select();
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
  <PanelView padded={false}>
    {#snippet toolbar()}
      <PanelToolbar>
        <PanelSearchInput
          bind:value={filter}
          bind:ref={searchInputEl}
          placeholder="Search conversations"
          ariaLabel="Search conversations"
          title={searchShortcut
            ? `Search conversations (${searchShortcut})`
            : "Search conversations"}
          ariaKeyshortcuts={searchShortcutAria}
        />
        <PanelToolbarGroup trailing>
          <PanelToolbarButton
            icon={List}
            label="Browse all conversations"
            disabled={!activeProject}
            onclick={() => (allConversationsOpen = true)}
          />
          <PanelToolbarButton
            icon={Plus}
            label={activeProject
              ? `New chat in ${activeProject.name}`
              : "New chat"}
            title="New chat"
            disabled={!activeProject}
            onclick={() => {
              if (activeProject)
                onNewConversationInProject?.(activeProject.dir);
            }}
          />
        </PanelToolbarGroup>
      </PanelToolbar>
    {/snippet}

    {#if !activeProject}
      <PanelEmpty title="No project selected." description={emptyStateHint} />
    {:else if rows.length === 0}
      <PanelEmpty
        title={filter
          ? "No conversations match your search."
          : "No conversations in this project yet."}
      >
        {#snippet action()}
          {#if !filter}
            <Button
              variant="outline"
              size="sm"
              onclick={() => onNewConversationInProject?.(activeProject.dir)}
              >New chat</Button
            >
          {/if}
        {/snippet}
      </PanelEmpty>
    {:else}
      <PanelList ariaLabel="Conversations">
        {#each rows as row (row.conversation.id)}
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
