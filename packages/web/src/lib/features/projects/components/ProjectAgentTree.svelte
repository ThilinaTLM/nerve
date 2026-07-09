<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import Plus from "@lucide/svelte/icons/plus";
  import type {
    ProjectRecord,
    PruneProjectConversationsRequest,
  } from "$lib/api";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import AlertDialog from "@nervekit/shared-ui/components/ui/confirm-dialog";
  import ContextMenu from "@nervekit/shared-ui/components/ui/context-menu-list";
  import { NavigatorPanel } from "@nervekit/shared-ui/components/navigator";
  import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
  import PruneConversationsDialog from "./PruneConversationsDialog.svelte";
  import { PanelSection } from "@nervekit/shared-ui/components/workbench";
  import {
    buildProjectGroups,
    type ProjectGroup,
    shortProjectLabel,
  } from "$lib/core/utils/project-tree";
  import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
  import {
    getShortcutAriaLabel,
    getShortcutLabel,
  } from "$lib/core/shortcuts/registry";
  import {
    loadProjectGroupCollapseState,
    saveProjectGroupCollapseState,
    type ProjectGroupCollapseState,
  } from "$lib/features/projects/state/project-group-collapse";
  import type {
    DeleteTarget,
    ProjectAgentTreeProps,
    PruneTarget,
  } from "./project-agent-tree-props";
  import {
    buildConversationMenu,
    buildProjectMenu,
    countAgeEligible,
    countKeepEligible,
    countProjectConversations,
    type ProjectTreeMenuContext,
  } from "./project-tree-menus";

  let {
    projects = [],
    conversations = [],
    agents = [],
    homeDir,
    selectedProjectId,
    selectedConversationId,
    openConversationTabIds,
    conversationActivityById = {},
    searchFocusToken = 0,
    editorAvailability,
    onOpenConversation,
    onNewConversationInProject,
    onOpenProjectInEditor,
    onDeleteProject,
    onDeleteConversation,
    onPruneProjectConversations,
  }: ProjectAgentTreeProps = $props();

  let filter = $state("");
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let collapsed = $state<ProjectGroupCollapseState>(
    loadProjectGroupCollapseState(),
  );
  let pendingDelete = $state<DeleteTarget | undefined>(undefined);
  let pendingPrune = $state<PruneTarget | undefined>(undefined);
  let pendingConversations = $state<ProjectGroup | undefined>(undefined);

  const searchShortcut = getShortcutLabel("projectSearch.focus");
  const searchShortcutAria = getShortcutAriaLabel("projectSearch.focus");
  const newConversationShortcut = getShortcutLabel("conversation.new");

  function requestDelete(target: DeleteTarget) {
    pendingDelete = target;
  }

  function setProjectGroupOpen(groupKey: string, open: boolean) {
    if (open) delete collapsed[groupKey];
    else collapsed[groupKey] = true;
    saveProjectGroupCollapseState({ ...collapsed });
  }

  const menuContext = $derived<ProjectTreeMenuContext>({
    homeDir,
    newConversationShortcut,
    editorAvailability,
    conversationCount: (projectId) =>
      countProjectConversations(conversations, projectId),
    onOpenConversation,
    onNewConversationInProject,
    onOpenProjectInEditor,
    requestPrune,
    requestDelete,
  });

  function requestPrune(project: ProjectRecord) {
    pendingPrune = {
      id: project.id,
      label: shortProjectLabel(project.dir, homeDir),
    };
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "project") onDeleteProject?.(pendingDelete.id);
    else onDeleteConversation?.(pendingDelete.id);
  }

  function confirmPrune(request: PruneProjectConversationsRequest) {
    if (!pendingPrune) return;
    onPruneProjectConversations?.(pendingPrune.id, request);
  }

  const result = $derived.by(() =>
    buildProjectGroups({ projects, conversations, agents, filter, homeDir }),
  );
  const groups = $derived(result.groups);
  const hiddenProjects = $derived(result.hiddenProjects);
</script>

<NavigatorPanel
  bind:searchValue={filter}
  bind:searchRef={searchInputEl}
  placeholder="Search projects / conversations"
  searchAriaLabel="Search projects or conversations"
  {searchFocusToken}
  {searchShortcut}
  {searchShortcutAria}
>
        {#if groups.length === 0}
          <p class="empty">No projects yet.</p>
        {/if}

        {#each groups as group (group.key)}
          <ContextMenu items={buildProjectMenu(group.project, menuContext)} triggerClass="project-context-trigger">
            <PanelSection
              title={group.label}
              icon={Folder}
              open={!collapsed[group.key]}
              onOpenChange={(open) => setProjectGroupOpen(group.key, open)}
            >
              {#snippet meta()}
                {#if group.totalRows > 0}
                  <span class="project-count">{group.totalRows}</span>
                {/if}
              {/snippet}
              {#snippet actions()}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="New chat in project"
                  ariaLabel="New chat"
                  onclick={() => onNewConversationInProject?.(group.project.dir)}
                >
                  <Plus />
                </Button>
              {/snippet}

              <div class="conversation-list">
                {#if group.rows.length === 0}
                  <p class="empty child">No conversations.</p>
                {/if}
                {#each group.rows as row (row.conversation.id)}
                  <ProjectAgentTreeNode
                    {row}
                    isOpen={openConversationTabIds?.has(row.conversation.id) ?? false}
                    isActive={row.conversation.id === selectedConversationId}
                    activity={conversationActivityById[row.conversation.id]}
                    menuItems={buildConversationMenu(group.project, row.conversation, menuContext)}
                    {onOpenConversation}
                  />
                {/each}
                {#if group.hiddenRows > 0}
                  <button
                    type="button"
                    class="more-button"
                    onclick={() => (pendingConversations = group)}
                  >+{group.hiddenRows} more</button>
                {/if}
              </div>
            </PanelSection>
          </ContextMenu>
        {/each}

        {#if hiddenProjects > 0}
          <p class="empty">+{hiddenProjects} more projects</p>
        {/if}
</NavigatorPanel>

<AlertDialog
  open={!!pendingDelete}
  title={pendingDelete?.kind === "project" ? "Remove project?" : "Delete conversation?"}
  description={pendingDelete
    ? pendingDelete.kind === "project"
      ? `This removes “${pendingDelete.label}” from Nerve and deletes its Nerve conversations. Files on disk are not deleted.`
      : `This permanently removes “${pendingDelete.label}”.`
    : ""}
  confirmLabel={pendingDelete?.kind === "project" ? "Remove" : "Delete"}
  destructive
  onConfirm={confirmDelete}
  onOpenChange={(open) => { if (!open) pendingDelete = undefined; }}
/>

{#if pendingConversations}
  <ProjectConversationsDialog
    open={!!pendingConversations}
    projectLabel={pendingConversations.label}
    project={pendingConversations.project}
    projectIds={pendingConversations.projects.map((project) => project.id)}
    {conversations}
    {agents}
    {selectedConversationId}
    {openConversationTabIds}
    {conversationActivityById}
    {onOpenConversation}
    buildMenu={(conversation) =>
      pendingConversations
        ? buildConversationMenu(pendingConversations.project, conversation, menuContext)
        : []}
    onOpenChange={(open) => { if (!open) pendingConversations = undefined; }}
  />
{/if}

<PruneConversationsDialog
  open={!!pendingPrune}
  projectLabel={pendingPrune?.label ?? ""}
  totalCount={pendingPrune ? countProjectConversations(conversations, pendingPrune.id) : 0}
  ageEligible={(days) => (pendingPrune ? countAgeEligible(conversations, pendingPrune.id, days) : 0)}
  keepEligible={(keep) => (pendingPrune ? countKeepEligible(conversations, pendingPrune.id, keep) : 0)}
  onConfirm={confirmPrune}
  onOpenChange={(open) => { if (!open) pendingPrune = undefined; }}
/>

<style>
  .empty {
    margin: 0.5rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .empty.child {
    margin: 0.2rem 0.1rem 0.1rem;
  }

  .more-button {
    display: block;
    width: fit-content;
    margin: 0.2rem 0.1rem 0.1rem;
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: start;
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }

  .more-button:hover {
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    color: var(--foreground);
  }

  .more-button:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ring) 60%, transparent);
  }

  /* ContextMenu trigger wrappers must not break the flex/card layout. */
  :global(.project-context-trigger) {
    display: block;
    width: 100%;
    min-width: 0;
  }

  /* Pull the conversation list to the card edges for full-width rows. */
  .conversation-list {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    margin: -0.35rem -0.55rem;
  }


  .project-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 400;
  }

</style>
