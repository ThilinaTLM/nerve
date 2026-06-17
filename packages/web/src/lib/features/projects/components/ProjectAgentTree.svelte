<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Folder from "@lucide/svelte/icons/folder";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import type {
    AgentRecord,
    ProjectRecord,
    ConversationRecord,
    ProjectEditor,
    PruneProjectConversationsRequest,
    StatusResponse,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import AlertDialog from "$lib/components/ui/confirm-dialog";
  import ContextMenu, {
    type ContextMenuItem,
  } from "$lib/components/ui/context-menu-list";
  import { Input } from "$lib/components/ui/input";
  import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
  import PruneConversationsDialog from "./PruneConversationsDialog.svelte";
  import type { ConversationActivityState } from "$lib/stores/workbench/conversation-activity";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import PanelSection from "$lib/app/layout/utility/PanelSection.svelte";
  import {
    buildProjectGroups,
    shortProjectLabel,
    type ProjectGroup,
  } from "$lib/utils/project-tree";
  import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
  import VsCodeIcon from "./VsCodeIcon.svelte";
  import ZedIcon from "./ZedIcon.svelte";
  import {
    getShortcutAriaLabel,
    getShortcutLabel,
  } from "$lib/shortcuts/registry";

  type DeleteTarget = {
    kind: "project" | "conversation";
    id: string;
    label: string;
  };

  type PruneTarget = {
    id: string;
    label: string;
  };

  type Props = {
    projects?: ProjectRecord[];
    conversations?: ConversationRecord[];
    agents?: AgentRecord[];
    homeDir?: string;
    selectedProjectId?: string;
    selectedConversationId?: string;
    openConversationTabIds?: Set<string>;
    conversationActivityById?: Record<string, ConversationActivityState>;
    searchFocusToken?: number;
    editorAvailability?: StatusResponse["runtime"]["editors"];
    onOpenConversation?: (conversationId: string) => void;
    onNewConversationInProject?: (projectDir: string) => void;
    onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
    onDeleteProject?: (projectId: string) => void;
    onDeleteConversation?: (conversationId: string) => void;
    onPruneProjectConversations?: (
      projectId: string,
      request: PruneProjectConversationsRequest,
    ) => void;
  };

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
  }: Props = $props();

  let filter = $state("");
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let lastSearchFocusToken = 0;
  let collapsed = $state<Record<string, boolean>>({});
  let pendingDelete = $state<DeleteTarget | undefined>(undefined);
  let pendingPrune = $state<PruneTarget | undefined>(undefined);
  let pendingConversations = $state<ProjectGroup | undefined>(undefined);

  const searchShortcut = getShortcutLabel("projectSearch.focus");
  const searchShortcutAria = getShortcutAriaLabel("projectSearch.focus");
  const newConversationShortcut = getShortcutLabel("conversation.new");

  $effect(() => {
    if (searchFocusToken === lastSearchFocusToken) return;
    lastSearchFocusToken = searchFocusToken;
    searchInputEl?.focus();
    searchInputEl?.select();
  });

  function requestDelete(target: DeleteTarget) {
    pendingDelete = target;
  }

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

  function projectConversationCount(projectId: string): number {
    return conversations.filter(
      (conversation) => conversation.projectId === projectId,
    ).length;
  }

  function ageEligibleCount(projectId: string, days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return conversations.filter((conversation) => {
      const updatedAt = Date.parse(conversation.updatedAt);
      return (
        conversation.projectId === projectId &&
        Number.isFinite(updatedAt) &&
        updatedAt < cutoff
      );
    }).length;
  }

  function keepEligibleCount(projectId: string, keep: number): number {
    return Math.max(0, projectConversationCount(projectId) - keep);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await writeClipboardText(text);
      notify.success(`Copied ${label}`);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  function projectEditorMenu(project: ProjectRecord): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (editorAvailability?.vscode.available) {
      items.push({
        label: "Open in VS Code",
        icon: VsCodeIcon,
        onSelect: () => onOpenProjectInEditor?.(project.id, "vscode"),
      });
    }
    if (editorAvailability?.zed.available) {
      items.push({
        label: "Open in Zed",
        icon: ZedIcon,
        onSelect: () => onOpenProjectInEditor?.(project.id, "zed"),
      });
    }
    return items;
  }

  function projectMenu(project: ProjectRecord): ContextMenuItem[] {
    const editorItems = projectEditorMenu(project);
    const items: ContextMenuItem[] = [
      {
        label: "New chat",
        icon: Plus,
        shortcut: newConversationShortcut,
        onSelect: () => onNewConversationInProject?.(project.dir),
      },
    ];
    if (editorItems.length > 0) {
      items.push({ type: "separator" }, ...editorItems);
    }
    items.push(
      { type: "separator" },
      {
        label: "Copy path",
        icon: Copy,
        onSelect: () => void copyToClipboard(project.dir, "path"),
      },
      {
        label: "Clean up",
        icon: Trash2,
        destructive: true,
        disabled: projectConversationCount(project.id) === 0,
        onSelect: () => requestPrune(project),
      },
      {
        label: "Remove project",
        icon: Trash2,
        destructive: true,
        onSelect: () =>
          requestDelete({
            kind: "project",
            id: project.id,
            label: shortProjectLabel(project.dir, homeDir),
          }),
      },
    );
    return items;
  }

  function conversationMenu(project: ProjectRecord, conversation: ConversationRecord): ContextMenuItem[] {
    return [
      { label: "Open conversation", icon: ArrowRight, onSelect: () => onOpenConversation?.(conversation.id) },
      { label: "New chat", icon: Plus, shortcut: newConversationShortcut, onSelect: () => onNewConversationInProject?.(project.dir) },
      { type: "separator" },
      { label: "Copy conversation id", icon: Copy, onSelect: () => void copyToClipboard(conversation.id, "conversation id") },
      {
        label: "Delete conversation",
        icon: Trash2,
        destructive: true,
        onSelect: () => requestDelete({ kind: "conversation", id: conversation.id, label: conversation.title }),
      },
    ];
  }

  const result = $derived.by(() =>
    buildProjectGroups({ projects, conversations, agents, filter, homeDir }),
  );
  const groups = $derived(result.groups);
  const hiddenProjects = $derived(result.hiddenProjects);
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <aside class="project-tree">
    <div class="search-box">
      <Search size={13} strokeWidth={2.25} aria-hidden="true" />
      <Input
        bind:ref={searchInputEl}
        bind:value={filter}
        size="sm"
        placeholder="Search projects / conversations"
        ariaLabel="Search projects or conversations"
        aria-keyshortcuts={searchShortcutAria}
        title={searchShortcut ? `Search projects / conversations (${searchShortcut})` : "Search projects / conversations"}
      />
    </div>

    <ScrollArea class="tree-scroll" viewportClass="tree-viewport" type="auto">
      <div class="tree-list">
        {#if groups.length === 0}
          <p class="empty">No projects yet.</p>
        {/if}

        {#each groups as group (group.key)}
          <ContextMenu items={projectMenu(group.project)} triggerClass="project-context-trigger">
            <PanelSection
              title={group.label}
              icon={Folder}
              open={!collapsed[group.key]}
              onOpenChange={(open) => (collapsed[group.key] = !open)}
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
                    menuItems={conversationMenu(group.project, row.conversation)}
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
      </div>
    </ScrollArea>
  </aside>
</Tooltip.Provider>

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
        ? conversationMenu(pendingConversations.project, conversation)
        : []}
    onOpenChange={(open) => { if (!open) pendingConversations = undefined; }}
  />
{/if}

<PruneConversationsDialog
  open={!!pendingPrune}
  projectLabel={pendingPrune?.label ?? ""}
  totalCount={pendingPrune ? projectConversationCount(pendingPrune.id) : 0}
  ageEligible={(days) => (pendingPrune ? ageEligibleCount(pendingPrune.id, days) : 0)}
  keepEligible={(keep) => (pendingPrune ? keepEligibleCount(pendingPrune.id, keep) : 0)}
  onConfirm={confirmPrune}
  onOpenChange={(open) => { if (!open) pendingPrune = undefined; }}
/>

<style>
  .project-tree {
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--card);
  }

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

  .search-box {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    align-items: center;
    padding: 0.45rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    background: transparent;
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.85rem;
    z-index: 1;
    color: var(--muted-foreground);
    pointer-events: none;
  }

  .search-box :global([data-slot="input"]) {
    padding-left: 1.75rem;
  }

  :global(.tree-scroll) {
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
  }

  :global(.tree-viewport) {
    width: 100%;
    min-width: 0;
    overflow-x: hidden;
    padding: 0.45rem;
  }

  .tree-list {
    display: flex;
    width: 100%;
    min-width: 0;
    flex-direction: column;
    gap: 0.5rem;
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
