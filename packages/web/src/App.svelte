<script lang="ts">
import { onMount } from "svelte";
import CodeMirrorComposer from "./lib/CodeMirrorComposer.svelte";
import Markdown from "./lib/Markdown.svelte";

type StatusResponse = {
  daemonId: string;
  version: string;
  startedAt: string;
  dataDir: string;
  storage: {
    home: string;
    sqlitePath: string;
    indexHealthy: boolean;
  };
};

type ClientConfig = {
  url: string;
  wsUrl: string;
  status: StatusResponse;
};

type EventEnvelope = {
  seq: number;
  type: string;
  data?: Record<string, unknown>;
};

type TranscriptItem = {
  role: "user" | "assistant";
  text: string;
};

let status = $state<StatusResponse | undefined>(undefined);
let connection = $state("connecting");
let events = $state<string[]>([]);
let error = $state<string | undefined>(undefined);
let projectDir = $state("");
let prompt = $state("");
let sending = $state(false);
let activeAgentId = $state<string | undefined>(undefined);
let activeSessionId = $state<string | undefined>(undefined);
let transcript = $state<TranscriptItem[]>([]);
let streamingText = $state("");
let socket: WebSocket | undefined;

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

async function ensureAgent(): Promise<string> {
  if (activeAgentId) return activeAgentId;
  const { project } = await apiPost<{ project: { id: string; name: string } }>(
    "/api/projects",
    { dir: projectDir || "." },
  );
  const { session } = await apiPost<{ session: { id: string } }>(
    "/api/sessions",
    { projectId: project.id, title: `Web session: ${project.name}` },
  );
  const { agent } = await apiPost<{ agent: { id: string } }>("/api/agents", {
    projectId: project.id,
    sessionId: session.id,
  });
  activeSessionId = session.id;
  activeAgentId = agent.id;
  return agent.id;
}

async function sendPrompt() {
  const text = prompt.trim();
  if (!text || sending) return;
  sending = true;
  error = undefined;
  streamingText = "";
  transcript = [...transcript, { role: "user", text }];
  prompt = "";
  try {
    const agentId = await ensureAgent();
    await apiPost(`/api/agents/${agentId}/prompt`, { text });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    sending = false;
  }
}

function handleEvent(event: EventEnvelope) {
  events = [JSON.stringify(event), ...events].slice(0, 8);
  const agentId = event.data?.agentId;
  if (agentId && agentId !== activeAgentId) return;
  if (event.type === "agent.message_delta") {
    streamingText += String(event.data?.delta ?? "");
  }
  if (event.type === "agent.message_complete") {
    const entry = event.data?.entry as { text?: string } | undefined;
    const text = streamingText || entry?.text || String(event.data?.text ?? "");
    if (text) transcript = [...transcript, { role: "assistant", text }];
    streamingText = "";
    sending = false;
  }
  if (event.type === "agent.error") {
    error = String(event.data?.message ?? "Agent error");
    sending = false;
  }
}

onMount(() => {
  async function connect() {
    try {
      const configResponse = await fetch("/api/client-config", {
        credentials: "same-origin",
      });
      if (!configResponse.ok) throw new Error(await configResponse.text());
      const config = (await configResponse.json()) as ClientConfig;
      status = config.status;
      projectDir = config.status.storage.home;

      socket = new WebSocket(new URL(config.wsUrl));
      socket.addEventListener("open", () => {
        connection = "live";
      });
      socket.addEventListener("message", (message) => {
        const parsed = JSON.parse(String(message.data)) as EventEnvelope;
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
  return () => socket?.close();
});
</script>

<main class="shell">
  <section class="hero-card">
    <div class="hero-topline">
      <span class="status-dot" class:live={connection === "live"}></span>
      <span>{connection}</span>
    </div>

    <div class="hero-grid">
      <div>
        <p class="eyebrow">minimal agent run</p>
        <h1>nerve</h1>
        <p class="lede">
          Create a project, session, and agent, then stream a response over the orchestrator WebSocket.
        </p>
      </div>

      <div class="panel">
        <h2>Daemon</h2>
        {#if status}
          <dl>
            <dt>ID</dt>
            <dd>{status.daemonId}</dd>
            <dt>Data</dt>
            <dd>{status.dataDir}</dd>
            <dt>Session</dt>
            <dd>{activeSessionId ?? "not started"}</dd>
            <dt>Agent</dt>
            <dd>{activeAgentId ?? "not started"}</dd>
          </dl>
        {:else if error}
          <p class="error">{error}</p>
        {:else}
          <p class="muted">Loading orchestrator status…</p>
        {/if}
      </div>
    </div>

    <section class="workspace">
      <div class="conversation">
        {#if transcript.length === 0 && !streamingText}
          <p class="muted">No messages yet. Send a prompt to start a minimal agent run.</p>
        {/if}
        {#each transcript as item}
          <article class="message" class:user={item.role === "user"}>
            <strong>{item.role}</strong>
            {#if item.role === "assistant"}
              <Markdown text={item.text} />
            {:else}
              <p>{item.text}</p>
            {/if}
          </article>
        {/each}
        {#if streamingText}
          <article class="message streaming">
            <strong>assistant</strong>
            <p>{streamingText}</p>
          </article>
        {/if}
      </div>

      <form class="composer" onsubmit={(event) => { event.preventDefault(); sendPrompt(); }}>
        <label>
          Project directory
          <input bind:value={projectDir} placeholder="/path/to/project" />
        </label>
        <div class="composer-label">
          <span>Prompt</span>
          <CodeMirrorComposer
            value={prompt}
            disabled={sending || connection !== "live"}
            onChange={(value) => (prompt = value)}
            onSubmit={sendPrompt}
          />
        </div>
        <button disabled={sending || connection !== "live"} type="submit">
          {sending ? "Streaming…" : "Send prompt"}
        </button>
        {#if error}<p class="error">{error}</p>{/if}
      </form>
    </section>

    <div class="event-strip">
      <h2>Event stream</h2>
      {#if events.length > 0}
        {#each events as event}
          <code>{event}</code>
        {/each}
      {:else}
        <p class="muted">Waiting for WebSocket events…</p>
      {/if}
    </div>
  </section>
</main>

<style>
  .shell {
    min-height: 100vh;
    padding: 32px;
    background:
      radial-gradient(circle at 20% 0%, rgb(56 189 248 / 16%), transparent 32rem),
      radial-gradient(circle at 90% 10%, rgb(129 140 248 / 12%), transparent 28rem),
      var(--color-bg);
  }

  .hero-card {
    width: min(1180px, 100%);
    margin: 0 auto;
    border: 1px solid var(--color-border);
    border-radius: 32px;
    background: linear-gradient(145deg, rgb(17 24 39 / 94%), rgb(7 10 16 / 92%));
    box-shadow: var(--shadow-panel);
    padding: clamp(24px, 4vw, 44px);
  }

  .hero-topline,
  .eyebrow {
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.76rem;
    font-weight: 700;
  }

  .hero-topline {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 24px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--color-muted);
  }

  .status-dot.live {
    background: var(--color-good);
    box-shadow: 0 0 24px rgb(134 239 172 / 80%);
  }

  .hero-grid,
  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
    gap: 28px;
    align-items: start;
  }

  h1 {
    margin: 8px 0 16px;
    font-size: clamp(4rem, 12vw, 8.5rem);
    line-height: 0.85;
    letter-spacing: -0.08em;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 1rem;
  }

  .lede {
    max-width: 680px;
    color: var(--color-muted);
    font-size: clamp(1.05rem, 2vw, 1.35rem);
    line-height: 1.55;
  }

  .panel,
  .event-strip,
  .conversation,
  .composer {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: rgb(11 16 32 / 72%);
    padding: 22px;
  }

  .workspace,
  .event-strip {
    margin-top: 28px;
  }

  .conversation {
    min-height: 330px;
  }

  .message {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    background: #020617;
    margin-bottom: 12px;
    white-space: pre-wrap;
  }

  .message.user {
    background: rgb(14 116 144 / 18%);
  }

  .message.streaming {
    border-color: rgb(125 211 252 / 55%);
  }

  .message p {
    margin: 8px 0 0;
    color: #dbeafe;
    line-height: 1.5;
  }

  .composer {
    display: grid;
    gap: 16px;
  }

  label {
    display: grid;
    gap: 8px;
    color: var(--color-muted);
    font-size: 0.9rem;
  }

  input {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #020617;
    color: var(--color-text);
    padding: 12px 14px;
  }

  .composer-label {
    display: grid;
    gap: 8px;
    color: var(--color-muted);
    font-size: 0.9rem;
  }

  button {
    border: 0;
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: #020617;
    padding: 12px 16px;
    font-weight: 800;
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px 16px;
    margin: 0;
  }

  dt {
    color: var(--color-muted);
  }

  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  code {
    display: block;
    overflow: auto;
    margin-top: 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #020617;
    color: #dbeafe;
    padding: 12px;
    font-size: 0.8rem;
  }

  .muted {
    color: var(--color-muted);
  }

  .error {
    color: #fca5a5;
  }

  @media (max-width: 860px) {
    .hero-grid,
    .workspace {
      grid-template-columns: 1fr;
    }
  }
</style>
