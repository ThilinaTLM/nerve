<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Copy from "@lucide/svelte/icons/copy";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { Collapsible, mergeProps } from "bits-ui";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
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
  import { pulseForStatus, statusTone } from "../../utils/status";
  import { dateTimeLabel } from "../../utils/time";

  type DeleteTarget = {
    kind: "project" | "session";
    id: string;
    label: string;
  };

  type Props = {
    projects?: ProjectRecord[];
    sessions?: SessionRecord[];
    agents?: AgentRecord[];
    homeDir?: string;
    selectedProjectId?: string;
    selectedSessionId?: string;
    onOpenSession?: (sessionId: string) => void;
    onNewConversationInProject?: (projectDir: string) => void;
    onDeleteProject?: (projectId: string) => void;
    onDeleteSession?: (sessionId: string) => void;
  };

  let {
    projects = [],
    sessions = [],
    agents = [],
    homeDir,
    selectedProjectId,
    selectedSessionId,
    onOpenSession,
    onNewConversationInProject,
    onDeleteProject,
    onDeleteSession,
  }: Props = $props();

  let filter = $state("");
  let collapsed = $state<Record<string, boolean>>({});
  let pendingDelete = $state<DeleteTarget | undefined>(undefined);

  function requestDelete(target: DeleteTarget) {
    pendingDelete = target;
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "project") onDeleteProject?.(pendingDelete.id);
    else onDeleteSession?.(pendingDelete.id);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function projectMenu(project: ProjectRecord): ContextMenuItem[] {
    return [
      { label: "New conversation", icon: Plus, onSelect: () => onNewConversationInProject?.(project.dir) },
      { type: "separator" },
      { label: "Copy path", icon: Copy, onSelect: () => void copyToClipboard(project.dir, "path") },
      {
        label: "Delete project",
        icon: Trash2,
        destructive: true,
        onSelect: () => requestDelete({ kind: "project", id: project.id, label: shortProjectLabel(project.dir, homeDir) }),
      },
    ];
  }

  function sessionMenu(project: ProjectRecord, session: SessionRecord): ContextMenuItem[] {
    return [
      { label: "Open conversation", icon: ArrowRight, onSelect: () => onOpenSession?.(session.id) },
      { label: "New conversation", icon: Plus, onSelect: () => onNewConversationInProject?.(project.dir) },
      { type: "separator" },
      { label: "Copy conversation id", icon: Copy, onSelect: () => void copyToClipboard(session.id, "conversation id") },
      {
        label: "Delete conversation",
        icon: Trash2,
        destructive: true,
        onSelect: () => requestDelete({ kind: "session", id: session.id, label: session.title }),
      },
    ];
  }

  function rowStatus(row: ConversationRow): string {
    return row.agent?.status ?? "idle";
  }

  function rowMode(row: ConversationRow): string {
    return row.agent?.mode ?? row.session.mode;
  }

  function rowPermission(row: ConversationRow): string {
    return row.agent?.permissionLevel ?? row.session.permissionLevel;
  }

  const result = $derived.by(() =>
    buildProjectGroups({ projects, sessions, agents, filter, homeDir }),
  );
  const groups = $derived(result.groups);
  const hiddenProjects = $derived(result.hiddenProjects);
</script>

<Sidebar.Provider>
  <Tooltip.Provider delayDuration={300} disableHoverableContent>
    <aside class="project-tree">
      <div class="search-box">
        <Search size={13} strokeWidth={2.25} aria-hidden="true" />
        <Input bind:value={filter} size="sm" placeholder="Search projects / conversations" ariaLabel="Search projects or conversations" />
      </div>

      <ScrollArea class="tree-scroll" viewportClass="tree-viewport" type="auto">
        <Sidebar.Group class="tree-group">
          <Sidebar.Menu>
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
                              <Sidebar.MenuButton {...mergeProps(trg, tip)} class="project-button bg-card w-full min-w-0">
                                <ChevronDown class="chevron" size={12} aria-hidden="true" />
                                <span class="project-label">{group.label}</span>
                              </Sidebar.MenuButton>
                            {/snippet}
                          </Collapsible.Trigger>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content side="right" sideOffset={6} class="nav-tooltip">{group.project.dir}</Tooltip.Content>
                    </Tooltip.Root>
                  </ContextMenu>
                  {#if group.totalRows > 0}
                    <Sidebar.MenuBadge class="count-badge transition-opacity duration-150 group-hover/menu-item:opacity-0">{group.totalRows}</Sidebar.MenuBadge>
                  {/if}
                  <Sidebar.MenuAction
                    showOnHover
                    title="New conversation in project"
                    aria-label="New conversation"
                    onclick={() => onNewConversationInProject?.(group.project.dir)}
                  >
                    <Plus size={12} strokeWidth={2.25} />
                  </Sidebar.MenuAction>
                  <Collapsible.Content>
                    <Sidebar.MenuSub class="conversation-sub me-0 pe-0">
                      {#if group.rows.length === 0}
                        <p class="empty child">No conversations.</p>
                      {/if}
                      {#each group.rows as row (row.session.id)}
                        {@const status = rowStatus(row)}
                        <Sidebar.MenuSubItem>
                          <ContextMenu items={sessionMenu(group.project, row.session)}>
                            <Tooltip.Root>
                              <Tooltip.Trigger>
                                {#snippet child({ props: tip })}
                                  <Sidebar.MenuSubButton
                                    isActive={row.session.id === selectedSessionId}
                                    class="conversation-button w-full"
                                  >
                                    {#snippet child({ props: btn })}
                                      <button
                                        {...mergeProps(btn, tip)}
                                        type="button"
                                        onclick={() => onOpenSession?.(row.session.id)}
                                      >
                                        <StatusDot
                                          tone={statusTone(status)}
                                          pulse={pulseForStatus(status)}
                                          size="sm"
                                        />
                                        <span class="conversation-label">{row.session.title}</span>
                                      </button>
                                    {/snippet}
                                  </Sidebar.MenuSubButton>
                                {/snippet}
                              </Tooltip.Trigger>
                              <Tooltip.Content side="right" sideOffset={6} class="nav-tooltip conversation-tooltip">
                                <span class="tt-title">{row.session.title}</span>
                                <span class="tt-row"><span class="tt-key">status</span>{status}</span>
                                <span class="tt-row"><span class="tt-key">mode</span>{rowMode(row)} · {rowPermission(row)}</span>
                                <span class="tt-row"><span class="tt-key">model</span>{shortAgentModel(row.agent)}</span>
                                <span class="tt-row"><span class="tt-key">updated</span>{dateTimeLabel(row.session.updatedAt)}</span>
                                <span class="tt-id">{row.session.id}</span>
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
    padding: 0.35rem;
  }

  :global(.tree-group),
  :global(.conversation-sub),
  :global(.tree-group [data-sidebar="menu-item"]),
  :global(.tree-group [data-sidebar="menu-sub-item"]) {
    width: 100%;
    min-width: 0;
    max-width: 100%;
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

  /* Count badge sits where the hover "+" action appears; swap them on hover. */
  :global(.count-badge) {
    top: 0.35rem;
    color: color-mix(in oklab, var(--muted-foreground) 90%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .conversation-label {
    font-size: var(--text-sm);
    font-weight: 450;
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
