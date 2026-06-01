<script lang="ts">
  import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
  import Button from "../ui/Button.svelte";

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
    if (!agent?.model) return "model";
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
    <strong>Projects</strong>
    <Button size="sm" variant="ghost" onclick={onNewConversation}>New</Button>
  </header>

  <input class="tree-search" bind:value={filter} placeholder="Search projects or agents" />

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
          onclick={() => (collapsed[group.project.id] = !collapsed[group.project.id])}
        >
          <span class="chevron">{collapsed[group.project.id] ? "▸" : "▾"}</span>
          <span class="project-name">{group.project.name}</span>
          <small>{group.rows.length}</small>
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
                onclick={() => onOpenSession?.(row.session.id)}
              >
                <span class={`status ${row.agent?.status ?? "idle"}`}></span>
                <span class="agent-main">
                  <strong>{row.session.title}</strong>
                  <small>{row.agent?.mode ?? row.session.mode} · {row.agent?.permissionLevel ?? row.session.permissionLevel} · {shortModel(row.agent)}</small>
                </span>
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
  }

  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 2.1rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .tree-header strong {
    font-size: 0.78rem;
    font-weight: 650;
  }

  .tree-search {
    height: 1.85rem;
    border: 0;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0 0.55rem;
    font-size: 0.78rem;
  }

  .tree-search:focus {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  .tree-scroll {
    min-height: 0;
    overflow: auto;
    padding: 0.3rem;
  }

  .project-row,
  .agent-row {
    width: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }

  .project-row {
    display: grid;
    grid-template-columns: 1rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.2rem;
    padding: 0.35rem 0.4rem;
    color: var(--color-muted);
    font-size: 0.76rem;
  }

  .project-row:hover,
  .agent-row:hover,
  .agent-row.selected {
    background: var(--color-panel-raised);
  }

  .project-row.active .project-name {
    color: var(--color-text);
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
    gap: 0.1rem;
    margin-bottom: 0.35rem;
  }

  .agent-row {
    display: grid;
    grid-template-columns: 0.55rem minmax(0, 1fr);
    align-items: center;
    gap: 0.4rem;
    min-height: 2.55rem;
    padding: 0.35rem 0.45rem 0.35rem 1.15rem;
    border-left: 2px solid transparent;
  }

  .agent-row.selected {
    border-left-color: var(--color-accent);
  }

  .status {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--color-faint);
  }

  .status.running {
    background: var(--color-accent);
  }

  .status.error {
    background: var(--color-danger);
  }

  .agent-main {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .agent-main strong {
    font-size: 0.78rem;
    font-weight: 550;
  }

  .agent-main small,
  .empty {
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
