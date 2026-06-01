<script lang="ts">
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import FolderKanban from "lucide-svelte/icons/folder-kanban";
  import Plus from "lucide-svelte/icons/plus";
  import Search from "lucide-svelte/icons/search";
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Input from "../ui/Input.svelte";

  type ConversationRow = {
    session: SessionRecord;
    agent?: AgentRecord;
  };

  type ProjectGroup = {
    project: ProjectRecord;
    rows: ConversationRow[];
    updatedAt: string;
  };

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

  function shortModel(agent: AgentRecord | undefined): string {
    if (!agent?.model) return "model pending";
    return agent.model.modelId.replace(/^claude-/, "claude ").replace(/^gpt-/, "gpt ");
  }

  function rowAgent(session: SessionRecord): AgentRecord | undefined {
    return agents.find((agent) => agent.id === session.activeAgentId) ?? agents.find((agent) => agent.sessionId === session.id);
  }

  function matches(group: ProjectGroup, query: string): boolean {
    if (!query) return true;
    const normalized = query.toLowerCase();
    return group.project.name.toLowerCase().includes(normalized) ||
      group.project.dir.toLowerCase().includes(normalized) ||
      group.rows.some((row) => row.session.title.toLowerCase().includes(normalized) || row.session.id.toLowerCase().includes(normalized));
  }

  function statusTone(status: string | undefined): "neutral" | "accent" | "good" | "warn" | "danger" | "running" {
    if (status === "running") return "running";
    if (status === "error") return "danger";
    if (status === "completed") return "good";
    return "neutral";
  }

  const groups = $derived.by(() => {
    const byProject = new Map<string, ProjectGroup>();
    for (const project of projects) {
      byProject.set(project.id, { project, rows: [], updatedAt: project.updatedAt });
    }
    for (const session of sessions) {
      const project = projects.find((candidate) => candidate.id === session.projectId);
      if (!project) continue;
      const group = byProject.get(project.id) ?? { project, rows: [], updatedAt: project.updatedAt };
      group.rows.push({ session, agent: rowAgent(session) });
      if (session.updatedAt > group.updatedAt) group.updatedAt = session.updatedAt;
      byProject.set(project.id, group);
    }
    return [...byProject.values()]
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
      <strong>Navigator</strong>
      <span>{projects.length} project{projects.length === 1 ? "" : "s"}</span>
    </div>
    <Button size="sm" variant="ghost" onclick={onNewConversation}><Plus size={13} strokeWidth={2.25} />New</Button>
  </header>

  <div class="search-box">
    <Search size={13} strokeWidth={2.25} aria-hidden="true" />
    <Input bind:value={filter} size="sm" placeholder="Search projects or agents" ariaLabel="Search projects or agents" />
  </div>

  <div class="tree-scroll">
    {#if groups.length === 0}
      <p class="empty">No projects yet.</p>
    {/if}

    {#each groups as group}
      <section class="project-group">
        <button
          class="project-row"
          class:active={group.project.id === selectedProjectId}
          type="button"
          title={group.project.dir}
          onclick={() => (collapsed[group.project.id] = !collapsed[group.project.id])}
        >
          <span class="chevron" aria-hidden="true">
            {#if collapsed[group.project.id]}<ChevronRight size={13} />{:else}<ChevronDown size={13} />{/if}
          </span>
          <FolderKanban size={13} strokeWidth={2.15} aria-hidden="true" />
          <span class="project-name">{group.project.name}</span>
          <Badge tone={group.project.id === selectedProjectId ? "accent" : "neutral"}>{group.rows.length}</Badge>
        </button>
        {#if !collapsed[group.project.id]}
          <div class="agent-rows">
            {#if group.rows.length === 0}
              <p class="empty child">No agent conversations.</p>
            {/if}
            {#each group.rows as row}
              <button
                class="agent-row"
                class:selected={row.session.id === selectedSessionId}
                type="button"
                title={`${row.session.title} · ${row.session.id}`}
                onclick={() => onOpenSession?.(row.session.id)}
              >
                <span class={`status ${row.agent?.status ?? "idle"}`}></span>
                <span class="agent-main">
                  <strong>{row.session.title}</strong>
                  <small>{row.agent?.mode ?? row.session.mode} · {row.agent?.permissionLevel ?? row.session.permissionLevel} · {shortModel(row.agent)}</small>
                </span>
                <Badge tone={statusTone(row.agent?.status)}>{row.agent?.status ?? "idle"}</Badge>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
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
    min-height: 2.45rem;
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .tree-header div {
    display: grid;
    gap: 0.05rem;
  }

  .tree-header strong {
    font-size: 0.78rem;
    font-weight: 700;
  }

  .tree-header span,
  .empty {
    color: var(--color-muted);
    font-size: 0.7rem;
  }

  .search-box {
    position: relative;
    display: grid;
    align-items: center;
    padding: 0.4rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-pane);
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.8rem;
    z-index: 1;
    color: var(--color-muted);
    pointer-events: none;
  }

  .search-box :global(.ui-input) {
    padding-left: 1.65rem;
  }

  .tree-scroll {
    min-height: 0;
    overflow: auto;
    padding: 0.35rem;
  }

  .project-group {
    display: grid;
    gap: 0.1rem;
  }

  .project-row,
  .agent-row {
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }

  .project-row {
    display: grid;
    grid-template-columns: 0.85rem auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.28rem;
    padding: 0.34rem 0.38rem;
    color: var(--color-muted);
    font-size: 0.76rem;
  }

  .project-row:hover,
  .project-row.active,
  .agent-row:hover,
  .agent-row.selected {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
  }

  .project-row.active .project-name {
    color: var(--color-text);
  }

  .chevron {
    display: inline-grid;
    place-items: center;
    color: var(--color-faint);
  }

  .project-name,
  .agent-main strong,
  .agent-main small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-rows {
    display: grid;
    gap: 0.12rem;
    margin: 0 0 0.4rem;
  }

  .agent-row {
    display: grid;
    grid-template-columns: 0.55rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
    min-height: 2.68rem;
    padding: 0.36rem 0.45rem 0.36rem 1.15rem;
    border-left: 2px solid transparent;
  }

  .agent-row.selected {
    border-left-color: var(--color-accent);
  }

  .status {
    width: 0.48rem;
    height: 0.48rem;
    border-radius: 999px;
    background: var(--color-faint);
    box-shadow: 0 0 0 3px rgb(255 255 255 / 3%);
  }

  .status.running {
    background: var(--color-accent);
  }

  .status.error {
    background: var(--color-danger);
  }

  .status.completed {
    background: var(--color-good);
  }

  .agent-main {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .agent-main strong {
    font-size: 0.78rem;
    font-weight: 600;
  }

  .agent-main small {
    color: var(--color-muted);
    font-size: 0.7rem;
  }

  .empty {
    margin: 0.5rem;
  }

  .empty.child {
    margin-left: 1.2rem;
  }
</style>
