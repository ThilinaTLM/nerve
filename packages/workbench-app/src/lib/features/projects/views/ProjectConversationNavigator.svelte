<script lang="ts">
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Plus from "@lucide/svelte/icons/plus";
import Settings from "@lucide/svelte/icons/settings";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelScrollRegion,
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
import PruneConversationsDialog from "./PruneConversationsDialog.svelte";
import { getShortcutLabel } from "$lib/application/commands/command-registry";
import {
  buildConversationMenu,
  countAgeEligible,
  countCompletedEligible,
  countKeepEligible,
  countProjectConversations,
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
  agents = [],
  selectedProjectId,
  selectedConversationId,
  openConversationTabIds,
  conversationActivityById = {},
  searchFocusToken = 0,
  editorAvailability,
  terminalAvailability,
  homeDir,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onOpenProjectInTerminal,
  onDeleteConversation,
  onUpdateConversationState,
  onPruneProjectConversations,
}: ProjectAgentTreeProps = $props();

const MAX_LISTED_CONVERSATIONS = 100;

let pendingDelete = $state<DeleteTarget | undefined>();
let allConversationsOpen = $state(false);
let settingsOpen = $state(false);
let cleanUpOpen = $state(false);

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const sections = $derived(
  buildConversationSections({
    conversations,
    agents,
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
  onOpenConversation,
  conversationActivity: (conversationId) =>
    conversationActivityById[conversationId],
  onUpdateConversationState,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onOpenProjectInTerminal,
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
                onNewConversationInProject?.(activeProject.dir);
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
        {/each}
      </PanelScrollRegion>
    {/if}
  </PanelView>
</Tooltip.Provider>
<ConversationListSettingsDialog
  bind:open={settingsOpen}
  hideCompleted={conversationListPreferences.hideCompleted}
  cleanUpDisabled={!activeProject ||
    countProjectConversations(conversations, activeProject.id) === 0}
  onHideCompletedChange={setHideCompletedConversations}
  onCleanUp={() => (cleanUpOpen = true)}
/>

{#if activeProject}
  <PruneConversationsDialog
    bind:open={cleanUpOpen}
    projectLabel={activeProject.name}
    totalCount={countProjectConversations(conversations, activeProject.id)}
    ageEligible={(days) =>
      countAgeEligible(conversations, activeProject.id, days)}
    keepEligible={(keep) =>
      countKeepEligible(conversations, activeProject.id, keep)}
    completedEligible={() =>
      countCompletedEligible(conversations, activeProject.id)}
    onConfirm={(request) =>
      onPruneProjectConversations?.(activeProject.id, request)}
  />
{/if}

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
