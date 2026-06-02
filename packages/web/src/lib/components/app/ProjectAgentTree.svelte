<script lang="ts">
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import FolderKanban from "lucide-svelte/icons/folder-kanban";
  import MoreHorizontal from "lucide-svelte/icons/more-horizontal";
  import Plus from "lucide-svelte/icons/plus";
  import Search from "lucide-svelte/icons/search";
  import { Collapsible } from "bits-ui";
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import DropdownMenu from "../ui/DropdownMenu.svelte";
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
    pendingDelete = undefined;
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
            <DropdownMenu
              ariaLabel="Project actions"
              triggerClass="row-menu-trigger"
              items={[{ value: "delete", label: "Delete project", tone: "danger" }]}
              onSelect={(value) => value === "delete" && requestDelete({ kind: "project", id: group.project.id, label: shortProjectLabel(group.project.dir, homeDir) })}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </DropdownMenu>
          </div>
        </div>
        <Collapsible.Content class="conversation-rows" hiddenUntilFound>
          {#if group.rows.length === 0}
            <p class="empty child">No conversations.</p>
          {/if}
          {#each group.rows as row}
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
              <div class="row-actions">
                <DropdownMenu
                  ariaLabel="Conversation actions"
                  triggerClass="row-menu-trigger"
                  items={[{ value: "delete", label: "Delete conversation", tone: "danger" }]}
                  onSelect={(value) => value === "delete" && requestDelete({ kind: "session", id: row.session.id, label: row.session.title })}
                >
                  <MoreHorizontal size={13} aria-hidden="true" />
                </DropdownMenu>
              </div>
            </div>
          {/each}
        </Collapsible.Content>
      </Collapsible.Root>
    {/each}
  </ScrollArea>
</aside>

<Dialog
  open={!!pendingDelete}
  title={pendingDelete?.kind === "project" ? "Delete project?" : "Delete conversation?"}
  description={pendingDelete
    ? `This permanently removes “${pendingDelete.label}”${pendingDelete.kind === "project" ? " and all its conversations." : "."}`
    : ""}
  onOpenChange={(open) => { if (!open) pendingDelete = undefined; }}
>
  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (pendingDelete = undefined)}>Cancel</Button>
    <Button variant="danger" size="sm" onclick={confirmDelete}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  .project-tree {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    border-right: 1px solid var(--color-border);
    background: var(--color-pane);
  }

  .section-label,
  .empty {
    color: var(--color-muted);
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
    border-bottom: 1px solid var(--color-border-subtle);
    background: transparent;
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.85rem;
    z-index: 1;
    color: var(--color-muted);
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
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }

  :global(.project-row) {
    display: grid;
    grid-template-columns: 0.85rem auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.35rem;
    padding: 0.36rem 0.42rem;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .project-row-wrap.active :global(.project-row)::before,
  .conversation-row-wrap.selected .conversation-row::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    border-radius: 999px;
    background: var(--color-accent);
  }

  :global(.project-row:hover),
  .project-row-wrap.active :global(.project-row),
  .conversation-row:hover,
  .conversation-row-wrap.selected .conversation-row {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
  }

  .project-row-wrap.active :global(.project-label) {
    color: var(--color-text);
  }

  :global(.project-row[data-state="closed"] .chevron) {
    transform: rotate(-90deg);
  }

  .chevron {
    display: inline-grid;
    place-items: center;
    color: var(--color-faint);
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
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .row-status {
    color: var(--color-muted);
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
  .project-row-wrap:focus-within .row-actions,
  .conversation-row-wrap:hover .row-actions,
  .conversation-row-wrap:focus-within .row-actions {
    opacity: 1;
  }

  .row-actions :global(.ui-button),
  .row-actions :global(.row-menu-trigger) {
    width: 1.4rem;
    height: 1.4rem;
    min-width: 0;
    border: none;
    background: var(--color-panel-raised);
    color: var(--color-muted);
    padding: 0;
  }

  .row-actions :global(.row-menu-trigger:hover),
  .row-actions :global(.ui-button:hover) {
    color: var(--color-text);
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
