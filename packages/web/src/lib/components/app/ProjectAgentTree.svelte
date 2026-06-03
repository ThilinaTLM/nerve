<script lang="ts">
  import ArrowRight from "lucide-svelte/icons/arrow-right";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import Copy from "lucide-svelte/icons/copy";
  import FolderKanban from "lucide-svelte/icons/folder-kanban";
  import Plus from "lucide-svelte/icons/plus";
  import Search from "lucide-svelte/icons/search";
  import Trash2 from "lucide-svelte/icons/trash-2";
  import { Collapsible } from "bits-ui";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
  import AlertDialog from "../ui/AlertDialog.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu.svelte";
  import Input from "../ui/Input.svelte";
  import ScrollArea from "../ui/ScrollArea.svelte";
  import StatusDot from "../ui/StatusDot.svelte";
  import { pulseForStatus, statusTone } from "../../utils/status";
  import {
    buildProjectGroups,
    conversationMeta,
    groupIsActive,
    projectKey,
    shortProjectLabel,
  } from "../../utils/project-tree";

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
    onNewConversation?: () => void;
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
    onNewConversation,
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
      { label: "Copy session id", icon: Copy, onSelect: () => void copyToClipboard(session.id, "session id") },
      {
        label: "Delete conversation",
        icon: Trash2,
        destructive: true,
        onSelect: () => requestDelete({ kind: "session", id: session.id, label: session.title }),
      },
    ];
  }

  const projectDirectoryCount = $derived.by(() => new Set(projects.map(projectKey)).size);

  const groups = $derived.by(() => buildProjectGroups({ projects, sessions, agents, filter }));
</script>

<aside class="project-tree">
  <div class="search-box">
    <Search size={13} strokeWidth={2.25} aria-hidden="true" />
    <Input bind:value={filter} size="sm" placeholder="Search projects / sessions" ariaLabel="Search projects or conversations" />
  </div>

  <ScrollArea class="tree-scroll" viewportClass="tree-viewport" type="auto">
    <div class="section-label">
      <span>Projects</span>
      <Badge size="xs">{projectDirectoryCount}</Badge>
      <span class="section-spacer"></span>
      <Button variant="icon" size="icon" ariaLabel="New agent" title="New agent" onclick={onNewConversation}>
        <Plus size={13} strokeWidth={2.25} />
      </Button>
    </div>

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
              <FolderKanban size={13} strokeWidth={2.15} aria-hidden="true" />
              <strong class="project-label">{shortProjectLabel(group.project.dir, homeDir)}</strong>
              <Badge size="xs" tone={active ? "accent" : "neutral"}>{group.rows.length}</Badge>
            </Collapsible.Trigger>
            <div class="row-actions">
              <Button
                variant="icon"
                size="icon"
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
                  title={`${row.session.title} · ${conversationMeta(row)} · ${row.session.id}`}
                  onclick={() => onOpenSession?.(row.session.id)}
                >
                  <StatusDot tone={statusTone(row.agent?.status)} pulse={pulseForStatus(row.agent?.status)} />
                  <strong class="conversation-label">{row.session.title}</strong>
                  <span class="row-status">{row.agent?.status ?? "idle"}</span>
                </button>
              </div>
            </ContextMenu>
          {/each}
        </Collapsible.Content>
      </Collapsible.Root>
    {/each}
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
    border-right: 1px solid hsl(var(--border));
    background: hsl(var(--card));
  }

  .section-label,
  .empty {
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .section-label {
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .search-box {
    position: relative;
    display: grid;
    align-items: center;
    padding: 0.45rem;
    border-bottom: 1px solid hsl(var(--border) / 0.6);
    background: transparent;
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.85rem;
    z-index: 1;
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }

  .search-box :global(.ui-input) {
    padding-left: 1.75rem;
  }

  :global(.tree-scroll) {
    min-height: 0;
  }

  :global(.tree-viewport) {
    padding: 0.35rem;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.25rem 0.45rem;
  }

  .section-spacer {
    flex: 1;
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
    color: hsl(var(--foreground));
    text-align: left;
    cursor: pointer;
  }

  :global(.project-row) {
    display: grid;
    grid-template-columns: 0.85rem auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.35rem;
    padding: 0.36rem 0.42rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-xs);
  }

  .project-row-wrap.active :global(.project-row)::before,
  .conversation-row-wrap.selected .conversation-row::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    border-radius: 999px;
    background: hsl(var(--primary));
  }

  :global(.project-row:hover),
  .project-row-wrap.active :global(.project-row),
  .conversation-row:hover,
  .conversation-row-wrap.selected .conversation-row {
    border-color: hsl(var(--border) / 0.6);
    background: hsl(var(--accent));
  }

  .project-row-wrap.active :global(.project-label) {
    color: hsl(var(--foreground));
  }

  :global(.project-row[data-state="closed"] .chevron) {
    transform: rotate(-90deg);
  }

  .chevron {
    display: inline-grid;
    place-items: center;
    color: hsl(var(--muted-foreground) / 0.75);
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
    color: hsl(var(--muted-foreground));
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .row-status {
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
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
    background: hsl(var(--accent));
    color: hsl(var(--muted-foreground));
    padding: 0;
  }

  .row-actions :global(.ui-button:hover) {
    color: hsl(var(--foreground));
  }

  :global(.conversation-rows) {
    display: grid;
    gap: 0.08rem;
    margin: 0 0 0.35rem;
    overflow: hidden;
  }

  .conversation-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
    min-height: 2.1rem;
    padding: 0.34rem 0.42rem 0.34rem 1.1rem;
  }

  .conversation-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .empty {
    margin: 0.5rem;
  }

  .empty.child {
    margin-left: 1.2rem;
  }
</style>
