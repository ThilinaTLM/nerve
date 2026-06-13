<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Folder from "@lucide/svelte/icons/folder";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/notifications/notify.svelte";
  import type {
    AgentRecord,
    ProjectRecord,
    ConversationRecord,
    PruneProjectConversationsRequest,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import AlertDialog from "$lib/components/ui/confirm-dialog";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { Input } from "$lib/components/ui/input";
  import PruneConversationsDialog from "./PruneConversationsDialog.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import PanelSection from "$lib/components/app/utility/PanelSection.svelte";
  import {
    buildProjectGroups,
    type ConversationRow,
    shortAgentModel,
    shortProjectLabel,
  } from "$lib/utils/project-tree";
  import { agentActivityPulse, agentActivityTone } from "$lib/utils/status";
  import { dateTimeLabel } from "$lib/utils/time";
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
    searchFocusToken?: number;
    onOpenConversation?: (conversationId: string) => void;
    onNewConversationInProject?: (projectDir: string) => void;
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
    searchFocusToken = 0,
    onOpenConversation,
    onNewConversationInProject,
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

  function projectMenu(project: ProjectRecord): ContextMenuItem[] {
    return [
      { label: "New chat", icon: Plus, shortcut: newConversationShortcut, onSelect: () => onNewConversationInProject?.(project.dir) },
      { type: "separator" },
      { label: "Copy path", icon: Copy, onSelect: () => void copyToClipboard(project.dir, "path") },
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
        onSelect: () => requestDelete({ kind: "project", id: project.id, label: shortProjectLabel(project.dir, homeDir) }),
      },
    ];
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

  function rowStatus(row: ConversationRow): string {
    return row.agent?.status ?? "idle";
  }

  function rowMode(row: ConversationRow): string {
    return row.agent?.mode ?? row.conversation.mode;
  }

  function rowPermission(row: ConversationRow): string {
    return row.agent?.permissionLevel ?? row.conversation.permissionLevel;
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
                  {@const status = rowStatus(row)}
                  {@const isOpen = openConversationTabIds?.has(row.conversation.id) ?? false}
                  {@const isActive = row.conversation.id === selectedConversationId}
                  <ContextMenu items={conversationMenu(group.project, row.conversation)} triggerClass="conversation-context-trigger">
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props: tip })}
                          <button
                            {...tip}
                            type="button"
                            class="conversation-row"
                            data-active={isActive}
                            onclick={() => onOpenConversation?.(row.conversation.id)}
                          >
                            <StatusDot
                              class="conversation-status"
                              tone={agentActivityTone(status)}
                              pulse={agentActivityPulse(status)}
                              variant={isOpen ? "solid" : "outline"}
                              size="sm"
                            />
                            <span class="conversation-label">{row.conversation.title}</span>
                          </button>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content side="right" sideOffset={6} class="nav-tooltip conversation-tooltip">
                        <span class="tt-title">{row.conversation.title}</span>
                        <span class="tt-row"><span class="tt-key">status</span>{status}</span>
                        <span class="tt-row"><span class="tt-key">mode</span>{rowMode(row)} · {rowPermission(row)}</span>
                        <span class="tt-row"><span class="tt-key">model</span>{shortAgentModel(row.agent)}</span>
                        <span class="tt-row"><span class="tt-key">updated</span>{dateTimeLabel(row.conversation.updatedAt)}</span>
                        <span class="tt-id">{row.conversation.id}</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </ContextMenu>
                {/each}
                {#if group.hiddenRows > 0}
                  <p class="empty child">+{group.hiddenRows} more</p>
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
  :global(.project-context-trigger),
  :global(.conversation-context-trigger) {
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

  .conversation-row {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }

  .conversation-row:hover {
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    color: var(--foreground);
  }

  .conversation-row[data-active="true"] {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .conversation-row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ring) 60%, transparent);
  }

  :global(.conversation-status) {
    flex: none;
  }

  /* Solid-fill the status dot on hover/active so open vs. idle stays legible. */
  .conversation-row:hover :global(.conversation-status),
  .conversation-row[data-active="true"] :global(.conversation-status) {
    background-color: currentColor;
  }

  .conversation-label {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  /* Styled, non-clipping tooltips (Portal-rendered) */
  :global(.nav-tooltip) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    max-width: 22rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  :global(.conversation-tooltip) .tt-title {
    margin-bottom: 0.15rem;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  :global(.conversation-tooltip) .tt-row {
    display: flex;
    gap: 0.4rem;
  }

  :global(.conversation-tooltip) .tt-key {
    min-width: 3.4rem;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  :global(.conversation-tooltip) .tt-id {
    margin-top: 0.2rem;
    color: var(--muted-foreground);
  }
</style>
