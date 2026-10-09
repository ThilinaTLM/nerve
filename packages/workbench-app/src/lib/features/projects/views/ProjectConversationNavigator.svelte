<script lang="ts">
import type { ConversationSummary } from "@nervekit/contracts/core";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Plus from "@lucide/svelte/icons/plus";
import Settings from "@lucide/svelte/icons/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelSectionHeader,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panels";
import {
  buildConversationSections,
  limitConversationSections,
} from "$lib/domain/projects/project-tree";
import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
import ConversationListSettingsDialog from "./ConversationListSettingsDialog.svelte";
import { conversationLists } from "$lib/application/workspace/conversation-lists.svelte";
import { getShortcutLabel } from "$lib/application/commands/command-registry";
import {
  buildConversationMenu,
  type ProjectTreeMenuContext,
} from "./project-tree-menus";
import type {
  DeleteTarget,
  ProjectAgentTreeProps,
} from "./project-agent-tree-props";
import {
  conversationListPreferences,
  setHideCompletedConversations,
} from "$lib/features/projects/state/conversation-list-preferences.svelte";

let {
  projects = [],
  conversations = [],
  selectedProjectId,
  selectedConversationId,
  openConversationTabIds,
  conversationActivityById = {},
  searchFocusToken = 0,
  editorAvailability,
  terminalAvailability,
  maintenanceActive = false,
  homeDir,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onOpenProjectInTerminal,
  onDeleteProject,
  onDeleteConversation,
  onUpdateConversationState,
}: ProjectAgentTreeProps = $props();

const MAX_LISTED_CONVERSATIONS = 100;

let pendingDelete = $state<DeleteTarget | undefined>();
let renameTarget = $state<ConversationSummary>();
let renameTitle = $state("");
let renameOpen = $state(false);
let allConversationsOpen = $state(false);
let settingsOpen = $state(false);

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const sections = $derived(
  buildConversationSections({
    conversations,
    projectIds,
    hideCompleted: conversationListPreferences.hideCompleted,
  }),
);
const rowCount = $derived(
  sections.reduce((count, section) => count + section.rows.length, 0),
);
const displayedSections = $derived(
  limitConversationSections(sections, MAX_LISTED_CONVERSATIONS),
);
const hasProjectConversations = $derived(
  conversations.some((conversation) =>
    projectIds.includes(conversation.projectId),
  ),
);
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
  terminalAvailability,
  conversationCount: (projectId) =>
    conversations.filter((conversation) => conversation.projectId === projectId)
      .length,
  maintenanceActive,
  onOpenConversation,
  conversationActivity: (conversationId) =>
    conversationActivityById[conversationId],
  onUpdateConversationState,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onOpenProjectInTerminal,
  requestDelete: (target) => (pendingDelete = target),
  requestRename: (conversation) => {
    renameTarget = conversation;
    renameTitle = conversation.title;
    renameOpen = true;
  },
});
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <PanelView padded={false} scroll={false}>
    <PanelHeader title="Conversations" count={rowCount}>
      {#snippet trailing()}
        <PanelToolbarButton
          icon={Settings}
          label="Conversation settings"
          onclick={() => (settingsOpen = true)}
        />
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
                onNewConversationInProject?.(activeProject.directory);
            }}
          />
        </span>
      {/snippet}
    </PanelHeader>

    {#if !activeProject}
      <PanelEmpty title="No project selected." description={emptyStateHint} />
    {:else if rowCount === 0}
      <PanelEmpty
        icon={MessagesSquare}
        title={hasProjectConversations
          ? "No conversations to show"
          : "No conversations yet"}
        description={hasProjectConversations
          ? "Completed conversations are hidden."
          : "Conversations are scoped to this project."}
      >
        {#snippet action()}
          <Button
            variant="outline"
            size="xs"
            onclick={() =>
              onNewConversationInProject?.(activeProject.directory)}
          >
            <Plus />
            New chat
          </Button>
        {/snippet}
      </PanelEmpty>
    {:else}
      <ScrollRegion
        ariaLabel="Conversations"
        topShadowClass="top-7 h-2"
        contentClass="pb-2"
      >
        {#each displayedSections as section (section.key)}
          <PanelSectionHeader
            title={section.label}
            count={section.rows.length}
          />
          <PanelList
            ariaLabel={`${section.label} conversations`}
            class="shrink-0 gap-1 pb-0"
          >
            {#each section.rows as row (row.conversation.id)}
              {@const rowProject =
                projects.find(
                  (project) => project.id === row.conversation.projectId,
                ) ?? activeProject}
              {@const list = conversationLists.get(row.conversation.projectId)}
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
                expanded={list?.expanded[row.conversation.id] ?? false}
                onToggleChildren={() => {
                  void list?.toggleChildren(row.conversation.id);
                }}
              />
              {#if list?.expanded[row.conversation.id]}
                {#each list.children[row.conversation.id] ?? [] as child (child.id)}
                  <ProjectAgentTreeNode
                    row={{ conversation: child }}
                    child
                    isOpen={openConversationTabIds?.has(child.id) ?? false}
                    isActive={child.id === selectedConversationId}
                    menuItems={buildConversationMenu(
                      rowProject,
                      child,
                      menuContext,
                    )}
                    {onOpenConversation}
                  />
                {/each}
              {/if}
            {/each}
          </PanelList>
        {/each}
      </ScrollRegion>
    {/if}
  </PanelView>
</Tooltip.Provider>
<DialogShell
  bind:open={renameOpen}
  title="Rename conversation"
  description="Choose a title for this conversation."
>
  <form
    class="flex flex-col gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      if (!renameTarget || !renameTitle.trim()) return;
      onUpdateConversationState?.(renameTarget.id, {
        title: renameTitle.trim(),
      });
      renameOpen = false;
    }}
  >
    <Input bind:value={renameTitle} aria-label="Conversation title" />
    <div class="flex justify-end">
      <Button type="submit" size="sm" disabled={!renameTitle.trim()}
        >Save</Button
      >
    </div>
  </form>
</DialogShell>
<ConversationListSettingsDialog
  bind:open={settingsOpen}
  hideCompleted={conversationListPreferences.hideCompleted}
  onHideCompletedChange={setHideCompletedConversations}
/>

<AlertDialog
  open={pendingDelete?.kind === "project"}
  title="Remove project?"
  description={pendingDelete
    ? `This removes “${pendingDelete.label}” from Nerve and deletes its Nerve conversations. Files on disk are not deleted.`
    : ""}
  confirmLabel="Remove"
  destructive
  onConfirm={() => {
    if (pendingDelete?.kind === "project" && !maintenanceActive)
      onDeleteProject?.(pendingDelete.id);
  }}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>

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
    {selectedConversationId}
    {openConversationTabIds}
    {conversationActivityById}
    hideCompleted={conversationListPreferences.hideCompleted}
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
