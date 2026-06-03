<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Copy from "@lucide/svelte/icons/copy";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { Collapsible } from "bits-ui";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
  import AlertDialog from "$lib/components/ui/confirm-dialog";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { Input } from "$lib/components/ui/input";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import {
    buildProjectGroups,
    conversationMeta,
    groupIsActive,
    shortProjectLabel,
  } from "../../utils/project-tree";
  import { pulseForStatus, statusTone } from "../../utils/status";

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

  const result = $derived.by(() =>
    buildProjectGroups({ projects, sessions, agents, filter }),
  );
  const groups = $derived(result.groups);
  const hiddenProjects = $derived(result.hiddenProjects);
</script>

<aside class="project-tree">
  <div class="search-box">
    <Search size={13} strokeWidth={2.25} aria-hidden="true" />
    <Input bind:value={filter} size="sm" placeholder="Search projects / conversations" ariaLabel="Search projects or conversations" />
  </div>

  <ScrollArea class="tree-scroll" viewportClass="tree-viewport" type="auto">
    {#if groups.length === 0}
      <p class="empty">No projects yet.</p>
    {/if}

    {#each groups as group}
      {@const active = groupIsActive(group, selectedProjectId)}
      <Collapsible.Root class="project-group" open={!collapsed[group.key]} onOpenChange={(open) => (collapsed[group.key] = !open)}>
        <ContextMenu items={projectMenu(group.project)}>
          <div class="project-row-wrap" class:active>
            <Collapsible.Trigger class="project-row" title={group.project.dir}>
              <span class="chevron" aria-hidden="true">
                <ChevronDown size={13} />
              </span>
              <span class="project-label">{shortProjectLabel(group.project.dir, homeDir)}</span>
            </Collapsible.Trigger>
            <div class="row-actions">
              <Button
                variant="ghost"
                size="icon-sm"
                ariaLabel="New conversation"
                title="New conversation in project"
                onclick={() => onNewConversationInProject?.(group.project.dir)}
              >
                <Plus size={12} strokeWidth={2.25} />
              </Button>
            </div>
          </div>
        </ContextMenu>
        <Collapsible.Content class="conversation-rows" hiddenUntilFound>
          {#if group.rows.length === 0}
            <p class="empty child">No conversations.</p>
          {/if}
          {#each group.rows as row}
            <ContextMenu items={sessionMenu(group.project, row.session)}>
              <div class="conversation-row-wrap" class:selected={row.session.id === selectedSessionId}>
                <button
                  class="conversation-row"
                  type="button"
                  title={`${row.session.title} · ${row.agent?.status ?? "idle"} · ${conversationMeta(row)} · ${row.session.id}`}
                  onclick={() => onOpenSession?.(row.session.id)}
                >
                  <StatusDot
                    tone={statusTone(row.agent?.status)}
                    pulse={pulseForStatus(row.agent?.status)}
                    size="sm"
                  />
                  <span class="conversation-label">{row.session.title}</span>
                </button>
              </div>
            </ContextMenu>
          {/each}
          {#if group.hiddenRows > 0}
            <p class="empty child">+{group.hiddenRows} more…</p>
          {/if}
        </Collapsible.Content>
      </Collapsible.Root>
    {/each}

    {#if hiddenProjects > 0}
      <p class="empty">+{hiddenProjects} more projects…</p>
    {/if}
  </ScrollArea>
</aside>

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
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    border-right: 1px solid var(--border);
    background: var(--card);
  }

  .empty {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
  }

  .search-box {
    position: relative;
    display: grid;
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
    min-height: 0;
  }

  :global(.tree-viewport) {
    padding: 0.35rem;
  }

  :global(.project-group) {
    display: grid;
    gap: 0.08rem;
  }

  .project-row-wrap,
  .conversation-row-wrap {
    position: relative;
    display: block;
  }

  :global(.project-row),
  .conversation-row {
    position: relative;
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
  }

  :global(.project-row) {
    display: grid;
    grid-template-columns: 0.85rem minmax(0, 1fr);
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.42rem;
    border-color: color-mix(in oklab, var(--border) 45%, transparent);
    background: color-mix(in oklab, var(--accent) 55%, transparent);
    color: var(--foreground);
    font-size: 0.8125rem;
  }

  .project-row-wrap.active :global(.project-row)::before,
  .conversation-row-wrap.selected .conversation-row::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    border-radius: 999px;
    background: var(--primary);
  }

  :global(.project-row:hover),
  .project-row-wrap.active :global(.project-row),
  .conversation-row:hover,
  .conversation-row-wrap.selected .conversation-row {
    border-color: color-mix(in oklab, var(--border) 60%, transparent);
    background: var(--accent);
  }

  .project-row-wrap.active :global(.project-label) {
    color: var(--foreground);
  }

  :global(.project-row[data-state="closed"] .chevron) {
    transform: rotate(-90deg);
  }

  .chevron {
    display: inline-grid;
    place-items: center;
    color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
    transition: transform 120ms ease;
  }

  .project-label,
  .conversation-label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-label {
    color: var(--foreground);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .row-actions {
    position: absolute;
    top: 50%;
    right: 0.3rem;
    display: flex;
    align-items: center;
    gap: 0.1rem;
    transform: translateY(-50%);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .project-row-wrap:hover .row-actions,
  .project-row-wrap:focus-within .row-actions {
    opacity: 1;
  }

  .row-actions :global(.ui-button) {
    width: 1.4rem;
    height: 1.4rem;
    min-width: 0;
    border: none;
    background: var(--accent);
    color: var(--muted-foreground);
    padding: 0;
  }

  .row-actions :global(.ui-button:hover) {
    color: var(--foreground);
  }

  :global(.conversation-rows) {
    display: grid;
    gap: 0.08rem;
    margin: 0 0 0.35rem;
    overflow: hidden;
  }

  .conversation-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
    min-height: 2.1rem;
    padding: 0.34rem 0.42rem 0.34rem 0.72rem;
  }

  .conversation-label {
    font-size: 0.8125rem;
    font-weight: 400;
  }

  .empty {
    margin: 0.5rem;
  }

  .empty.child {
    margin-left: 1.2rem;
  }
</style>
