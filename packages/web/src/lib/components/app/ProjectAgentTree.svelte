<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Copy from "@lucide/svelte/icons/copy";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { Collapsible, mergeProps } from "bits-ui";
  import { notify } from "$lib/notifications/notify.svelte";
  import type { AgentRecord, ProjectRecord, ConversationRecord } from "../../api";
  import AlertDialog from "$lib/components/ui/confirm-dialog";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { Input } from "$lib/components/ui/input";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    buildProjectGroups,
    type ConversationRow,
    shortAgentModel,
    shortProjectLabel,
  } from "../../utils/project-tree";
  import { agentActivityPulse, agentActivityTone } from "../../utils/status";
  import { dateTimeLabel } from "../../utils/time";
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
    eligibleCount: number;
  };

  const pruneConversationDays = 7;

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
    onPruneProjectConversations?: (projectId: string) => void;
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
      eligibleCount: pruneEligibleCount(project.id),
    };
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "project") onDeleteProject?.(pendingDelete.id);
    else onDeleteConversation?.(pendingDelete.id);
  }

  function confirmPrune() {
    if (!pendingPrune) return;
    onPruneProjectConversations?.(pendingPrune.id);
  }

  function pruneEligibleCount(projectId: string): number {
    const cutoff = Date.now() - pruneConversationDays * 24 * 60 * 60 * 1000;
    return conversations.filter((conversation) => {
      const updatedAt = Date.parse(conversation.updatedAt);
      return (
        conversation.projectId === projectId &&
        Number.isFinite(updatedAt) &&
        updatedAt < cutoff
      );
    }).length;
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard?.writeText(text);
      notify.success(`Copied ${label}`);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  function projectMenu(project: ProjectRecord): ContextMenuItem[] {
    const eligibleCount = pruneEligibleCount(project.id);
    return [
      { label: "New conversation", icon: Plus, shortcut: newConversationShortcut, onSelect: () => onNewConversationInProject?.(project.dir) },
      { type: "separator" },
      { label: "Copy path", icon: Copy, onSelect: () => void copyToClipboard(project.dir, "path") },
      {
        label: "Prune Conversations",
        icon: Trash2,
        destructive: true,
        disabled: eligibleCount === 0,
        onSelect: () => requestPrune(project),
      },
      {
        label: "Delete project",
        icon: Trash2,
        destructive: true,
        onSelect: () => requestDelete({ kind: "project", id: project.id, label: shortProjectLabel(project.dir, homeDir) }),
      },
    ];
  }

  function conversationMenu(project: ProjectRecord, conversation: ConversationRecord): ContextMenuItem[] {
    return [
      { label: "Open conversation", icon: ArrowRight, onSelect: () => onOpenConversation?.(conversation.id) },
      { label: "New conversation", icon: Plus, shortcut: newConversationShortcut, onSelect: () => onNewConversationInProject?.(project.dir) },
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

<Sidebar.Provider>
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
        <Sidebar.Group class="tree-group">
          <Sidebar.Menu class="tree-menu">
            {#if groups.length === 0}
              <p class="empty">No projects yet.</p>
            {/if}

            {#each groups as group (group.key)}
              <Sidebar.MenuItem>
                <Collapsible.Root open={!collapsed[group.key]} onOpenChange={(open) => (collapsed[group.key] = !open)}>
                  <ContextMenu items={projectMenu(group.project)}>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props: tip })}
                          <Collapsible.Trigger>
                            {#snippet child({ props: trg })}
                              <Sidebar.MenuButton {...mergeProps(trg, tip)} class="project-button bg-card h-7 w-full min-w-0 px-1.5 py-1">
                                <ChevronDown class="chevron" size={12} aria-hidden="true" />
                                <span class="project-label">{group.label}</span>
                                {#if group.totalRows > 0}
                                  <span class="project-count">({group.totalRows})</span>
                                {/if}
                              </Sidebar.MenuButton>
                            {/snippet}
                          </Collapsible.Trigger>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content side="right" sideOffset={6} class="nav-tooltip">{group.project.dir}</Tooltip.Content>
                    </Tooltip.Root>
                  </ContextMenu>
                  <Sidebar.MenuAction
                    class="project-action"
                    title="New conversation in project"
                    aria-label="New conversation"
                    onclick={() => onNewConversationInProject?.(group.project.dir)}
                  >
                    <Plus size={12} strokeWidth={2.25} />
                  </Sidebar.MenuAction>
                  <Collapsible.Content>
                    <Sidebar.MenuSub class="conversation-sub me-0 gap-0 py-0 pe-0">
                      {#if group.rows.length === 0}
                        <p class="empty child">No conversations.</p>
                      {/if}
                      {#each group.rows as row (row.conversation.id)}
                        {@const status = rowStatus(row)}
                        {@const isOpen = openConversationTabIds?.has(row.conversation.id) ?? false}
                        <Sidebar.MenuSubItem>
                          <ContextMenu items={conversationMenu(group.project, row.conversation)}>
                            <Tooltip.Root>
                              <Tooltip.Trigger>
                                {#snippet child({ props: tip })}
                                  <Sidebar.MenuSubButton
                                    isActive={row.conversation.id === selectedConversationId}
                                    size="sm"
                                    class="conversation-button w-full"
                                  >
                                    {#snippet child({ props: btn })}
                                      <button
                                        {...mergeProps(btn, tip)}
                                        type="button"
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
                                  </Sidebar.MenuSubButton>
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
                        </Sidebar.MenuSubItem>
                      {/each}
                      {#if group.hiddenRows > 0}
                        <p class="empty child">+{group.hiddenRows} more…</p>
                      {/if}
                    </Sidebar.MenuSub>
                  </Collapsible.Content>
                </Collapsible.Root>
              </Sidebar.MenuItem>
            {/each}

            {#if hiddenProjects > 0}
              <p class="empty">+{hiddenProjects} more projects…</p>
            {/if}
          </Sidebar.Menu>
        </Sidebar.Group>
      </ScrollArea>
    </aside>
  </Tooltip.Provider>
</Sidebar.Provider>

<AlertDialog
  open={!!pendingDelete}
  title={pendingDelete?.kind === "project" ? "Delete project?" : "Delete conversation?"}
  description={pendingDelete
    ? `This permanently removes “${pendingDelete.label}”${pendingDelete.kind === "project" ? " and all its conversations." : "."}`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={confirmDelete}
  onOpenChange={(open) => { if (!open) pendingDelete = undefined; }}
/>

<AlertDialog
  open={!!pendingPrune}
  title="Prune old conversations?"
  description={pendingPrune
    ? `This permanently removes ${pendingPrune.eligibleCount} conversation${pendingPrune.eligibleCount === 1 ? "" : "s"} in “${pendingPrune.label}” last updated more than ${pruneConversationDays} days ago. Active conversations and active processes are skipped.`
    : ""}
  confirmLabel="Prune"
  destructive
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
    margin-left: 1.2rem;
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
    padding: 0.25rem 0.25rem 0.25rem 0.45rem;
  }

  :global(.tree-group),
  :global(.tree-menu),
  :global(.tree-group [data-sidebar="menu-item"]),
  :global(.tree-group [data-sidebar="menu-sub-item"]) {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  :global(.tree-group) {
    padding: 0;
  }

  :global(.tree-menu) {
    padding-inline-end: 0.25rem;
  }

  :global(.conversation-sub) {
    width: auto;
    min-width: 0;
    gap: 0;
    padding-block: 0.05rem;
    padding-inline-start: 0.25rem;
    padding-inline-end: 0;
  }

  :global(.conversation-button) {
    position: relative;
    height: 1.35rem;
    min-height: 1.35rem;
    gap: 0.35rem;
    border-radius: 0;
    background: transparent !important;
    color: var(--muted-foreground);
    padding-block: 0;
    padding-inline: 0.6rem 0.35rem;
    overflow: visible;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: color 120ms ease;
  }

  /* Status indicator sits centered on the vertical guide line. */
  :global(.conversation-status) {
    position: absolute;
    left: -0.5rem;
    top: 50%;
    transform: translateY(-50%);
  }

  :global(.conversation-button:hover),
  :global(.conversation-button:active),
  :global(.conversation-button[data-active="true"]) {
    background: transparent !important;
    box-shadow: none;
  }

  :global(.conversation-button:hover) {
    color: var(--sidebar-foreground);
  }

  :global(.conversation-button:hover) .conversation-label {
    color: var(--sidebar-foreground);
  }

  :global(.conversation-button[data-active="true"]) {
    color: var(--foreground);
  }

  :global(.conversation-button[data-active="true"]) .conversation-label {
    color: var(--foreground);
  }

  :global(.conversation-button:hover .conversation-status),
  :global(.conversation-button[data-active="true"] .conversation-status) {
    background-color: currentColor;
  }

  :global(.conversation-button:focus-visible) {
    outline: 1px solid color-mix(in oklab, var(--ring) 60%, transparent);
    outline-offset: -1px;
  }

  :global([data-sidebar="menu-button"][data-state="closed"]) .chevron {
    transform: rotate(-90deg);
  }

  .chevron {
    flex: none;
    color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
    transition: transform 150ms ease;
  }

  .project-label,
  .conversation-label {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-label {
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  .project-count {
    flex: none;
    margin-inline-start: -0.25rem;
    color: color-mix(in oklab, var(--muted-foreground) 90%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  /* Keep the "+" action vertically centered within the project label row. */
  :global(.project-button) {
    padding-inline-end: 1.6rem;
  }

  /* Vertically center within the h-7 (1.75rem) project label row. */
  :global(.project-action) {
    top: 0.25rem;
  }

  .conversation-label {
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
