<script lang="ts">
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import FolderKanban from "lucide-svelte/icons/folder-kanban";
  import Plus from "lucide-svelte/icons/plus";
  import Search from "lucide-svelte/icons/search";
  import { Collapsible } from "bits-ui";
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Input from "../ui/Input.svelte";
  import ScrollArea from "../ui/ScrollArea.svelte";
  import StatusDot from "../ui/StatusDot.svelte";

  type ConversationRow = {
    session: SessionRecord;
    agent?: AgentRecord;
  };

  type ProjectGroup = {
    key: string;
    project: ProjectRecord;
    projects: ProjectRecord[];
    rows: ConversationRow[];
    updatedAt: string;
  };

  type StatusTone = "neutral" | "accent" | "good" | "warn" | "danger" | "running";

  type Props = {
    projects?: ProjectRecord[];
    sessions?: SessionRecord[];
    agents?: AgentRecord[];
    selectedProjectId?: string;
    selectedSessionId?: string;
    onOpenSession?: (sessionId: string) => void;
    onNewConversation?: () => void;
  };

  let {
    projects = [],
    sessions = [],
    agents = [],
    selectedProjectId,
    selectedSessionId,
    onOpenSession,
    onNewConversation,
  }: Props = $props();

  let filter = $state("");
  let collapsed = $state<Record<string, boolean>>({});

  function projectKey(project: ProjectRecord): string {
    return project.dir.replace(/[\\/]+$/, "") || project.dir;
  }

  function shortModel(agent: AgentRecord | undefined): string {
    if (!agent?.model) return "model pending";
    return agent.model.modelId.replace(/^claude-/, "claude ").replace(/^gpt-/, "gpt ");
  }

  function rowAgent(session: SessionRecord): AgentRecord | undefined {
    return agents.find((agent) => agent.id === session.activeAgentId) ?? agents.find((agent) => agent.sessionId === session.id);
  }

  function groupIsActive(group: ProjectGroup): boolean {
    return group.projects.some((project) => project.id === selectedProjectId);
  }

  function matches(group: ProjectGroup, query: string): boolean {
    if (!query) return true;
    const normalized = query.toLowerCase();
    return group.project.name.toLowerCase().includes(normalized) ||
      group.project.dir.toLowerCase().includes(normalized) ||
      group.projects.some((project) => project.name.toLowerCase().includes(normalized) || project.dir.toLowerCase().includes(normalized)) ||
      group.rows.some((row) => row.session.title.toLowerCase().includes(normalized) || row.session.id.toLowerCase().includes(normalized));
  }

  function statusTone(status: string | undefined): StatusTone {
    if (status === "running") return "running";
    if (status === "error") return "danger";
    if (status === "completed") return "good";
    return "neutral";
  }

  const projectDirectoryCount = $derived.by(() => new Set(projects.map(projectKey)).size);
  const conversationCount = $derived(sessions.length);

  const groups = $derived.by(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const byDir = new Map<string, ProjectGroup>();

    for (const project of projects) {
      const key = projectKey(project);
      const existing = byDir.get(key);
      if (existing) {
        existing.projects.push(project);
        if (project.updatedAt > existing.updatedAt) existing.updatedAt = project.updatedAt;
        if (project.updatedAt > existing.project.updatedAt) existing.project = project;
      } else {
        byDir.set(key, { key, project, projects: [project], rows: [], updatedAt: project.updatedAt });
      }
    }

    for (const session of sessions) {
      const project = projectById.get(session.projectId);
      if (!project) continue;
      const key = projectKey(project);
      const group = byDir.get(key) ?? { key, project, projects: [project], rows: [], updatedAt: project.updatedAt };
      group.rows.push({ session, agent: rowAgent(session) });
      if (session.updatedAt > group.updatedAt) group.updatedAt = session.updatedAt;
      byDir.set(key, group);
    }

    return [...byDir.values()]
      .filter((group) => matches(group, filter.trim()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt)),
      }));
  });
</script>

<aside class="project-tree">
  <header class="tree-header">
    <div>
      <strong>Agents</strong>
      <span>{projectDirectoryCount} project{projectDirectoryCount === 1 ? "" : "s"} · {conversationCount} conversation{conversationCount === 1 ? "" : "s"}</span>
    </div>
    <Button size="sm" variant="ghost" onclick={onNewConversation}><Plus size={13} strokeWidth={2.25} />New</Button>
  </header>

  <div class="search-box">
    <Search size={13} strokeWidth={2.25} aria-hidden="true" />
    <Input bind:value={filter} size="sm" placeholder="Search projects or conversations" ariaLabel="Search projects or conversations" />
  </div>

  <ScrollArea class="tree-scroll" viewportClass="tree-viewport" type="auto">
    {#if groups.length === 0}
      <p class="empty">No projects yet.</p>
    {/if}

    {#each groups as group}
      {@const active = groupIsActive(group)}
      <Collapsible.Root class="project-group" open={!collapsed[group.key]} onOpenChange={(open) => (collapsed[group.key] = !open)}>
        <Collapsible.Trigger class={active ? "project-row active" : "project-row"} title={group.project.dir}>
          <span class="chevron" aria-hidden="true">
            <ChevronDown size={13} />
          </span>
          <FolderKanban size={13} strokeWidth={2.15} aria-hidden="true" />
          <span class="project-main">
            <strong>{group.project.name}</strong>
            <small>{group.project.dir}</small>
          </span>
          <Badge size="xs" tone={active ? "accent" : "neutral"}>{group.rows.length}</Badge>
        </Collapsible.Trigger>
        <Collapsible.Content class="conversation-rows" hiddenUntilFound>
          {#if group.rows.length === 0}
            <p class="empty child">No conversations.</p>
          {/if}
          {#each group.rows as row}
            <button
              class="conversation-row"
              class:selected={row.session.id === selectedSessionId}
              type="button"
              title={`${row.session.title} · ${row.session.id}`}
              onclick={() => onOpenSession?.(row.session.id)}
            >
              <StatusDot tone={statusTone(row.agent?.status)} pulse={row.agent?.status === "running"} />
              <span class="conversation-main">
                <strong>{row.session.title}</strong>
                <small>{row.agent?.mode ?? row.session.mode} · {row.agent?.permissionLevel ?? row.session.permissionLevel} · {shortModel(row.agent)}</small>
              </span>
              <span class="row-status">{row.agent?.status ?? "idle"}</span>
            </button>
          {/each}
        </Collapsible.Content>
      </Collapsible.Root>
    {/each}
  </ScrollArea>
</aside>

<style>
  .project-tree {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto auto minmax(0, 1fr);
    background: var(--color-panel-muted);
    border-right: 1px solid var(--color-border-subtle);
  }

  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--size-pane-header);
    padding: 0.38rem 0.48rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .tree-header div {
    display: grid;
    gap: 0.04rem;
  }

  .tree-header strong {
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
  }

  .tree-header span,
  .empty {
    color: var(--color-muted);
    font-size: var(--text-2xs);
  }

  .search-box {
    position: relative;
    display: grid;
    align-items: center;
    padding: 0.35rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-pane);
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.75rem;
    z-index: 1;
    color: var(--color-muted);
    pointer-events: none;
  }

  .search-box :global(.ui-input) {
    padding-left: 1.6rem;
  }

  :global(.tree-scroll) {
    min-height: 0;
  }

  :global(.tree-viewport) {
    padding: 0.3rem;
  }

  :global(.project-group) {
    display: grid;
    gap: 0.1rem;
  }

  :global(.project-row),
  .conversation-row {
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
    gap: 0.3rem;
    padding: 0.32rem 0.38rem;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  :global(.project-row:hover),
  :global(.project-row.active),
  .conversation-row:hover,
  .conversation-row.selected {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
  }

  :global(.project-row.active .project-main strong) {
    color: var(--color-text);
  }

  :global(.project-row[data-state="closed"] .chevron) {
    transform: rotate(-90deg);
  }

  .chevron {
    display: inline-grid;
    place-items: center;
    color: var(--color-faint);
    transition: transform 140ms ease;
  }

  .project-main,
  .conversation-main {
    display: grid;
    min-width: 0;
    gap: 0.04rem;
  }

  .project-main strong,
  .project-main small,
  .conversation-main strong,
  .conversation-main small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-main strong {
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .project-main small,
  .conversation-main small,
  .row-status {
    color: var(--color-muted);
    font-size: var(--text-2xs);
  }

  :global(.conversation-rows) {
    display: grid;
    gap: 0.12rem;
    margin: 0 0 0.35rem;
    overflow: hidden;
  }

  .conversation-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
    min-height: 2.5rem;
    padding: 0.32rem 0.42rem 0.32rem 1.1rem;
    border-left: 2px solid transparent;
  }

  .conversation-row.selected {
    border-left-color: var(--color-accent);
  }

  .conversation-main strong {
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
