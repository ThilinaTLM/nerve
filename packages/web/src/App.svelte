<script lang="ts">
  import { onMount } from "svelte";
  import { Pane, PaneGroup, PaneResizer } from "paneforge";
  import type { InspectorTab, ThemePreference } from "./lib/state/app-state.svelte";
  import {
    applyTheme,
    composerDraft,
    eventBuffer,
    layout,
    loadThemePreference,
    pushEventPreview,
    resetSelection,
    selection,
    themeState,
  } from "./lib/state/app-state.svelte";
  import {
    apiGet,
    apiPost,
    getClientConfig,
    getFileCompletions,
    getPendingApprovals,
    getSessionMessages,
    getSessionTree,
    getSlashCompletions,
    getWorkspaceSnapshot,
    type AgentRecord,
    type ApprovalWithToolCall,
    type ClientConfig,
    type CompletionItem,
    type EventEnvelope,
    type ProjectRecord,
    type SessionEntry,
    type SessionRecord,
    type SessionTreeNode,
    type StatusResponse,
  } from "./lib/api";
  import { queryClient, queryKeys } from "./lib/query";
  import Badge from "./lib/components/ui/Badge.svelte";
  import Button from "./lib/components/ui/Button.svelte";
  import Card from "./lib/components/ui/Card.svelte";
  import Input from "./lib/components/ui/Input.svelte";
  import { Tabs } from "./lib/components/ui/primitives";
  import CodeMirrorComposer from "./lib/CodeMirrorComposer.svelte";
  import Markdown from "./lib/Markdown.svelte";

  type TranscriptItem = {
    id?: string;
    role: "user" | "assistant";
    text: string;
  };

  let status = $state<StatusResponse | undefined>(undefined);
  let config = $state<ClientConfig | undefined>(undefined);
  let connection = $state("connecting");
  let error = $state<string | undefined>(undefined);
  let sending = $state(false);
  let projects = $state<ProjectRecord[]>([]);
  let sessions = $state<SessionRecord[]>([]);
  let agents = $state<AgentRecord[]>([]);
  let treeNodes = $state<SessionTreeNode[]>([]);
  let approvals = $state<ApprovalWithToolCall[]>([]);
  let transcript = $state<TranscriptItem[]>([]);
  let streamingText = $state("");
  let slashCompletions = $state<CompletionItem[]>([]);
  let socket: WebSocket | undefined;

  const activeProject = $derived(projects.find((project) => project.id === selection.projectId));
  const activeSession = $derived(sessions.find((session) => session.id === selection.sessionId));
  const activeAgent = $derived(agents.find((agent) => agent.id === selection.agentId));
  const live = $derived(connection === "live");
  const branchDepth = $derived(treeNodes.length);
  const pendingApprovalCount = $derived(approvals.length);

  function entriesToTranscript(entries: SessionEntry[]): TranscriptItem[] {
    return entries
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({ id: entry.id, role: entry.role as "user" | "assistant", text: entry.text }));
  }

  async function loadWorkspaceState() {
    const snapshot = await queryClient.fetchQuery({
      queryKey: queryKeys.workspace,
      queryFn: getWorkspaceSnapshot,
    });
    projects = snapshot.projects;
    sessions = snapshot.sessions;
    agents = snapshot.agents;
    approvals = await getPendingApprovals();
  }

  async function loadSlashCommands() {
    slashCompletions = await queryClient.fetchQuery({
      queryKey: queryKeys.slashCompletions,
      queryFn: getSlashCompletions,
    });
  }

  async function completeFiles(query: string): Promise<CompletionItem[]> {
    return queryClient.fetchQuery({
      queryKey: queryKeys.fileCompletions(selection.projectId, query),
      queryFn: () => getFileCompletions(selection.projectId, query),
      staleTime: 2_000,
    });
  }

  async function openSession(sessionId: string) {
    const session = sessions.find((candidate) => candidate.id === sessionId) ??
      (await apiGet<{ session: SessionRecord }>(`/api/sessions/${sessionId}`)).session;
    selection.sessionId = session.id;
    selection.projectId = session.projectId;
    selection.agentId = session.activeAgentId ?? agents.find((agent) => agent.sessionId === session.id)?.id;
    selection.entryId = session.activeEntryId;
    const project = projects.find((candidate) => candidate.id === session.projectId) ??
      (await apiGet<{ project: ProjectRecord }>(`/api/projects/${session.projectId}`)).project;
    composerDraft.projectDir = project.dir;
    const [entries, tree] = await Promise.all([
      getSessionMessages(session.id),
      getSessionTree(session.id),
    ]);
    transcript = entriesToTranscript(entries);
    treeNodes = tree.nodes;
    selection.entryId = tree.activeEntryId;
    streamingText = "";
    sending = false;
    layout.inspectorTab = "session";
  }

  async function navigateToEntry(entryId: string | undefined) {
    if (!selection.sessionId) return;
    await apiPost(`/api/sessions/${selection.sessionId}/navigate`, { activeEntryId: entryId ?? null });
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openSession(selection.sessionId);
    layout.inspectorTab = "branch";
  }

  function newSession() {
    resetSelection();
    transcript = [];
    treeNodes = [];
    streamingText = "";
    sending = false;
    composerDraft.text = "";
    layout.inspectorTab = "session";
  }

  async function ensureAgent(): Promise<string> {
    if (selection.agentId) return selection.agentId;
    if (selection.projectId && selection.sessionId) {
      const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
        projectId: selection.projectId,
        sessionId: selection.sessionId,
      });
      selection.agentId = agent.id;
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      await loadWorkspaceState();
      return agent.id;
    }
    const { project } = await apiPost<{ project: ProjectRecord }>(
      "/api/projects",
      { dir: composerDraft.projectDir || "." },
    );
    const { session } = await apiPost<{ session: SessionRecord }>(
      "/api/sessions",
      { projectId: project.id, title: `Workbench: ${project.name}` },
    );
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: project.id,
      sessionId: session.id,
    });
    selection.projectId = project.id;
    selection.sessionId = session.id;
    selection.entryId = session.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = project.dir;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    return agent.id;
  }

  async function grantApproval(approvalId: string) {
    await apiPost(`/api/approvals/${approvalId}/grant`, {});
    approvals = await getPendingApprovals();
    layout.inspectorTab = "events";
  }

  async function denyApproval(approvalId: string) {
    await apiPost(`/api/approvals/${approvalId}/deny`, { note: "Denied from UI." });
    approvals = await getPendingApprovals();
    layout.inspectorTab = "events";
  }

  async function abortActiveRun() {
    if (!selection.agentId) return;
    await apiPost(`/api/agents/${selection.agentId}/abort`, {});
    sending = false;
    streamingText = "";
  }

  async function sendPrompt() {
    const text = composerDraft.text.trim();
    if (!text || sending) return;
    if (text === "/abort") {
      composerDraft.text = "";
      await abortActiveRun();
      return;
    }
    sending = true;
    error = undefined;
    streamingText = "";
    transcript = [...transcript, { role: "user", text }];
    composerDraft.text = "";
    try {
      const agentId = await ensureAgent();
      await apiPost(`/api/agents/${agentId}/prompt`, { text });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      sending = false;
    }
  }

  function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
    pushEventPreview(JSON.stringify(event));
    const agentId = event.data?.agentId;
    if (agentId && agentId !== selection.agentId) return;
    if (event.type === "agent.message_delta") {
      streamingText += String(event.data?.delta ?? "");
    }
    if (event.type === "agent.message_complete") {
      const entry = event.data?.entry as { id?: string; text?: string } | undefined;
      const text = streamingText || entry?.text || String(event.data?.text ?? "");
      if (text) transcript = [...transcript, { id: entry?.id, role: "assistant", text }];
      selection.entryId = entry?.id ?? selection.entryId;
      streamingText = "";
      sending = false;
      if (selection.sessionId) void openSession(selection.sessionId);
    }
    if (event.type === "agent.error") {
      error = String(event.data?.message ?? "Agent error");
      sending = false;
    }
    if (
      event.type === "session.created" ||
      event.type === "agent.created" ||
      event.type === "project.created" ||
      event.type.startsWith("approval.") ||
      event.type.startsWith("agent.tool_call")
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      void loadWorkspaceState();
    }
  }

  function setTheme(preference: ThemePreference) {
    applyTheme(preference);
  }

  onMount(() => {
    let themeMedia: MediaQueryList | undefined;
    const handleSystemTheme = () => applyTheme(themeState.preference);

    async function connect() {
      try {
        applyTheme(loadThemePreference());
        themeMedia = window.matchMedia("(prefers-color-scheme: light)");
        themeMedia.addEventListener("change", handleSystemTheme);
        config = await getClientConfig();
        status = config.status;
        composerDraft.projectDir = config.status.storage.home;
        await Promise.all([loadWorkspaceState(), loadSlashCommands()]);

        socket = new WebSocket(new URL(config.wsUrl));
        socket.addEventListener("open", () => {
          connection = "live";
        });
        socket.addEventListener("message", (message) => {
          const parsed = JSON.parse(String(message.data)) as EventEnvelope<Record<string, unknown>>;
          if (parsed.type) handleEvent(parsed);
        });
        socket.addEventListener("close", () => {
          connection = "closed";
        });
        socket.addEventListener("error", () => {
          connection = "error";
        });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        connection = "error";
      }
    }

    connect();
    return () => {
      socket?.close();
      themeMedia?.removeEventListener("change", handleSystemTheme);
    };
  });
</script>

<svelte:head>
  <title>Nerve Workbench</title>
</svelte:head>

<main class="app-shell">
  <div class="ambient-grid"></div>
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark">N</div>
      <div>
        <p class="eyebrow">local orchestrator</p>
        <h1>Nerve Workbench</h1>
      </div>
    </div>

    <div class="topbar-actions">
      {#if pendingApprovalCount > 0}
        <Badge tone="warn">{pendingApprovalCount} approval{pendingApprovalCount === 1 ? "" : "s"}</Badge>
      {/if}
      <Badge tone={live ? "good" : "warn"}>
        <span class="status-dot" class:live></span>{connection}
      </Badge>
      <div class="theme-switch" aria-label="Theme preference">
        {#each ["system", "light", "dark"] as theme}
          <button
            class:active={themeState.preference === theme}
            type="button"
            onclick={() => setTheme(theme as ThemePreference)}
          >{theme}</button>
        {/each}
      </div>
    </div>
  </header>

  <PaneGroup direction="horizontal" class="workbench-panes">
    <Pane defaultSize={23} minSize={16} class="pane-shell sidebar-pane">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div>
            <p class="eyebrow">sessions</p>
            <h2>Run archive</h2>
          </div>
          <Button variant="ghost" size="sm" onclick={newSession}>New</Button>
        </div>

        {#if sessions.length > 0}
          <div class="session-list">
            {#each sessions as session}
              <button
                class="session-card"
                class:active={session.id === selection.sessionId}
                type="button"
                onclick={() => openSession(session.id)}
              >
                <span>{session.title}</span>
                <small>{session.id}</small>
                <em>{new Date(session.updatedAt).toLocaleString()}</em>
              </button>
            {/each}
          </div>
        {:else}
          <Card tone="muted" class="empty-card">
            <p>No durable sessions yet. Start from the composer.</p>
          </Card>
        {/if}
      </aside>
    </Pane>

    <PaneResizer class="pane-resizer" />

    <Pane defaultSize={52} minSize={34} class="pane-shell conversation-pane">
      <section class="conversation-column">
        <div class="conversation-header">
          <div>
            <p class="eyebrow">conversation</p>
            <h2>{activeSession?.title ?? "Unstarted session"}</h2>
          </div>
          <div class="conversation-meta">
            <Badge tone="accent">{activeAgent?.mode ?? "coding"}</Badge>
            <Badge>{activeAgent?.permissionLevel ?? "supervised"}</Badge>
          </div>
        </div>

        <div class="conversation-scroll">
          {#if transcript.length === 0 && !streamingText}
            <div class="empty-conversation">
              <span>◆</span>
              <h3>Ready for a local run</h3>
              <p>Pick a previous branch or send a prompt. Use <code>/</code> for commands and <code>@</code> for project files.</p>
            </div>
          {/if}

          {#each transcript as item}
            <article class="message" class:user={item.role === "user"}>
              <div class="message-rail">{item.role === "user" ? "you" : "ai"}</div>
              <div class="message-body">
                {#if item.role === "assistant"}
                  <Markdown text={item.text} />
                {:else}
                  <p>{item.text}</p>
                {/if}
              </div>
            </article>
          {/each}

          {#if streamingText}
            <article class="message streaming">
              <div class="message-rail">ai</div>
              <div class="message-body"><p>{streamingText}</p></div>
            </article>
          {/if}
        </div>

        <form class="composer-panel" onsubmit={(event) => { event.preventDefault(); sendPrompt(); }}>
          <label>
            <span>Project directory</span>
            <Input bind:value={composerDraft.projectDir} placeholder="/path/to/project" disabled={sending} />
          </label>
          <div class="composer-label">
            <span>Prompt</span>
            <CodeMirrorComposer
              value={composerDraft.text}
              disabled={sending || !live}
              {slashCompletions}
              fileCompletions={completeFiles}
              onChange={(value) => (composerDraft.text = value)}
              onSubmit={sendPrompt}
            />
          </div>
          <div class="composer-actions">
            <Button disabled={sending || !live} type="submit" size="lg">
              {sending ? "Streaming…" : "Send prompt"}
            </Button>
            <Button disabled={!sending} variant="secondary" onclick={abortActiveRun}>Abort</Button>
          </div>
          {#if error}<p class="error">{error}</p>{/if}
        </form>
      </section>
    </Pane>

    <PaneResizer class="pane-resizer" />

    <Pane defaultSize={25} minSize={18} class="pane-shell inspector-pane">
      <aside class="inspector">
        <Tabs.Root
          value={layout.inspectorTab}
          onValueChange={(value) => (layout.inspectorTab = value as InspectorTab)}
          class="inspector-tabs"
        >
          <Tabs.List class="tab-list">
            <Tabs.Trigger value="session" class="tab-trigger">Session</Tabs.Trigger>
            <Tabs.Trigger value="branch" class="tab-trigger">Branch</Tabs.Trigger>
            <Tabs.Trigger value="approvals" class="tab-trigger">Approvals</Tabs.Trigger>
            <Tabs.Trigger value="events" class="tab-trigger">Events</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="session" class="tab-content">
            <Card tone="muted" class="detail-card">
              <h3>Daemon</h3>
              <dl>
                <dt>ID</dt><dd>{status?.daemonId ?? "loading"}</dd>
                <dt>Data</dt><dd>{status?.dataDir ?? "—"}</dd>
                <dt>Index</dt><dd>{status?.storage.indexHealthy ? "healthy" : "unknown"}</dd>
              </dl>
            </Card>
            <Card tone="muted" class="detail-card">
              <h3>Active records</h3>
              <dl>
                <dt>Project</dt><dd>{activeProject?.name ?? "not selected"}</dd>
                <dt>Session</dt><dd>{selection.sessionId ?? "not started"}</dd>
                <dt>Agent</dt><dd>{selection.agentId ?? "not started"}</dd>
              </dl>
            </Card>
          </Tabs.Content>

          <Tabs.Content value="branch" class="tab-content">
            <div class="branch-header">
              <div>
                <p class="eyebrow">active path</p>
                <h3>{branchDepth} entries</h3>
              </div>
              <Button variant="ghost" size="sm" onclick={() => navigateToEntry(undefined)}>Root</Button>
            </div>
            {#if treeNodes.length > 0}
              <div class="branch-list">
                {#each treeNodes as node}
                  <button
                    class="branch-node"
                    class:active={node.entry.id === selection.entryId}
                    type="button"
                    onclick={() => navigateToEntry(node.entry.id)}
                  >
                    <strong>{node.entry.role}</strong>
                    <span>{node.entry.text.slice(0, 120) || node.entry.id}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <p class="muted">No branch metadata loaded.</p>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="approvals" class="tab-content">
            {#if approvals.length > 0}
              <div class="approval-list">
                {#each approvals as approval}
                  <Card tone="muted" class="approval-card">
                    <div class="approval-heading">
                      <div>
                        <p class="eyebrow">{approval.risk}</p>
                        <h3>{approval.toolCall?.toolName ?? "tool call"}</h3>
                      </div>
                      <Badge tone="warn">pending</Badge>
                    </div>
                    <p>{approval.reason}</p>
                    {#if approval.toolCall}
                      <code>{JSON.stringify(approval.toolCall.args, null, 2)}</code>
                    {/if}
                    <div class="approval-actions">
                      <Button size="sm" onclick={() => grantApproval(approval.id)}>Approve</Button>
                      <Button size="sm" variant="secondary" onclick={() => denyApproval(approval.id)}>Deny</Button>
                    </div>
                  </Card>
                {/each}
              </div>
            {:else}
              <p class="muted">No pending approvals.</p>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="events" class="tab-content">
            {#if eventBuffer.items.length > 0}
              <div class="event-list">
                {#each eventBuffer.items as event}
                  <code>{event}</code>
                {/each}
              </div>
            {:else}
              <p class="muted">Waiting for WebSocket events…</p>
            {/if}
          </Tabs.Content>
        </Tabs.Root>
      </aside>
    </Pane>
  </PaneGroup>
</main>

<style>
  .app-shell {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    padding: clamp(1rem, 2vw, 1.5rem);
    background:
      radial-gradient(circle at 18% 8%, var(--color-aurora-a), transparent 26rem),
      radial-gradient(circle at 78% 0%, var(--color-aurora-b), transparent 24rem),
      linear-gradient(135deg, var(--color-bg), var(--color-bg-deep));
  }

  .ambient-grid {
    pointer-events: none;
    position: absolute;
    inset: 0;
    opacity: var(--grid-opacity);
    background-image:
      linear-gradient(var(--color-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--color-grid) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(circle at 50% 20%, black, transparent 72%);
  }

  .topbar,
  :global(.workbench-panes) {
    position: relative;
    z-index: 1;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 auto 1rem;
    width: min(1680px, 100%);
  }

  .brand-lockup,
  .topbar-actions,
  .conversation-meta,
  .composer-actions,
  .branch-header,
  .approval-heading,
  .approval-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .brand-mark {
    display: grid;
    width: 3.25rem;
    height: 3.25rem;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: 1.1rem;
    background: var(--gradient-accent);
    color: var(--color-accent-ink);
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 900;
    box-shadow: var(--shadow-glow);
  }

  .eyebrow {
    margin: 0 0 0.25rem;
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    font-weight: 900;
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 0;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 3vw, 2.4rem);
    letter-spacing: -0.06em;
  }

  h2,
  h3 {
    margin-bottom: 0;
    letter-spacing: -0.035em;
  }

  .theme-switch {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-muted);
    padding: 0.2rem;
  }

  .theme-switch button {
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    cursor: pointer;
  }

  .theme-switch button.active {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: currentColor;
  }

  .status-dot.live {
    box-shadow: 0 0 18px var(--color-good);
  }

  :global(.workbench-panes) {
    width: min(1680px, 100%);
    height: calc(100vh - 6.25rem);
    min-height: 680px;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 1.8rem;
    background: var(--color-shell);
    box-shadow: var(--shadow-elevated);
  }

  :global(.pane-shell) {
    min-width: 0;
  }

  :global(.pane-resizer) {
    position: relative;
    width: 0.5rem;
    background: transparent;
  }

  :global(.pane-resizer)::after {
    content: "";
    position: absolute;
    inset: 1rem 0.18rem;
    border-radius: 999px;
    background: var(--color-border-subtle);
    transition: background 140ms ease;
  }

  :global(.pane-resizer):hover::after {
    background: var(--color-accent);
  }

  .sidebar,
  .inspector,
  .conversation-column {
    height: 100%;
    min-height: 0;
  }

  .sidebar,
  .inspector {
    padding: 1rem;
    background: var(--color-panel-muted);
  }

  .sidebar-header,
  .conversation-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .session-list,
  .branch-list,
  .event-list {
    display: grid;
    gap: 0.65rem;
  }

  .session-card,
  .branch-node {
    display: grid;
    width: 100%;
    gap: 0.28rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.78rem;
    text-align: left;
    cursor: pointer;
  }

  .session-card:hover,
  .branch-node:hover,
  .session-card.active,
  .branch-node.active {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .session-card small,
  .session-card em,
  .branch-node span,
  .muted {
    color: var(--color-muted);
  }

  .session-card small,
  .branch-node span,
  dd,
  code {
    overflow-wrap: anywhere;
  }

  .session-card em {
    font-size: 0.72rem;
    font-style: normal;
  }

  :global(.empty-card) {
    padding: 1rem;
  }

  .conversation-column {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: color-mix(in oklab, var(--color-bg), transparent 8%);
  }

  .conversation-header {
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 1.1rem 1.25rem;
    margin-bottom: 0;
  }

  .conversation-scroll {
    min-height: 0;
    overflow: auto;
    padding: 1.25rem;
  }

  .empty-conversation {
    display: grid;
    min-height: 100%;
    place-items: center;
    align-content: center;
    color: var(--color-muted);
    text-align: center;
  }

  .empty-conversation span {
    color: var(--color-accent);
    font-size: 2rem;
  }

  .empty-conversation h3 {
    color: var(--color-text);
  }

  .empty-conversation code {
    display: inline;
    padding: 0.1rem 0.3rem;
  }

  .message {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 0.9rem;
    margin-bottom: 1rem;
  }

  .message-rail {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: 0.8rem;
    background: var(--color-panel-muted);
    color: var(--color-muted);
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .message-body {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    padding: 1rem;
    box-shadow: var(--shadow-message);
  }

  .message.user .message-body {
    background: var(--color-user-message);
  }

  .message.streaming .message-body {
    border-color: var(--color-accent);
  }

  .message-body p {
    margin-bottom: 0;
    color: var(--color-message-text);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .composer-panel {
    display: grid;
    gap: 0.85rem;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 1rem 1.25rem 1.15rem;
  }

  label,
  .composer-label {
    display: grid;
    gap: 0.45rem;
    color: var(--color-muted);
    font-size: 0.86rem;
    font-weight: 700;
  }

  .error {
    margin: 0;
    color: var(--color-danger);
  }

  :global(.inspector-tabs) {
    display: grid;
    height: 100%;
    grid-template-rows: auto minmax(0, 1fr);
  }

  :global(.tab-list) {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
    margin-bottom: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-field);
    padding: 0.22rem;
  }

  :global(.tab-trigger) {
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    padding: 0.48rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 900;
    cursor: pointer;
  }

  :global(.tab-trigger[data-state="active"]) {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.tab-content) {
    min-height: 0;
    overflow: auto;
  }

  :global(.detail-card),
  :global(.approval-card) {
    margin-bottom: 0.75rem;
    padding: 1rem;
  }

  .approval-list {
    display: grid;
    gap: 0.75rem;
  }

  .approval-heading {
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .approval-actions {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.5rem 0.8rem;
    margin: 0.75rem 0 0;
    font-size: 0.86rem;
  }

  dt {
    color: var(--color-muted);
  }

  dd {
    margin: 0;
  }

  code {
    display: block;
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-code);
    padding: 0.72rem;
    font-size: 0.75rem;
  }

  @media (max-width: 980px) {
    :global(.workbench-panes) {
      display: block;
      height: auto;
      min-height: 0;
    }

    :global(.sidebar-pane),
    :global(.conversation-pane),
    :global(.inspector-pane) {
      display: block !important;
      width: 100% !important;
    }

    :global(.pane-resizer) {
      display: none;
    }

    .conversation-column {
      min-height: 680px;
    }
  }
</style>
