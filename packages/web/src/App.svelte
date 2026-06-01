<script lang="ts">
import { onMount } from "svelte";

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

let status = $state<StatusResponse | undefined>(undefined);
let connection = $state("connecting");
let events = $state<string[]>([]);
let error = $state<string | undefined>(undefined);

onMount(() => {
  let socket: WebSocket | undefined;

  async function connect() {
    try {
      const configResponse = await fetch("/api/client-config", {
        credentials: "same-origin",
      });
      if (!configResponse.ok) throw new Error(await configResponse.text());
      const config = (await configResponse.json()) as ClientConfig;
      status = config.status;

      const wsUrl = new URL(config.wsUrl);
      socket = new WebSocket(wsUrl);
      socket.addEventListener("open", () => {
        connection = "live";
      });
      socket.addEventListener("message", (message) => {
        events = [String(message.data), ...events].slice(0, 6);
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
        <p class="eyebrow">local-first coding harness</p>
        <h1>nerve</h1>
        <p class="lede">
          The foundation daemon is online: storage, local auth, HTTP status, and WebSocket events are wired.
        </p>
      </div>

      <div class="panel">
        <h2>Daemon</h2>
        {#if status}
          <dl>
            <dt>ID</dt>
            <dd>{status.daemonId}</dd>
            <dt>Version</dt>
            <dd>{status.version}</dd>
            <dt>Data</dt>
            <dd>{status.dataDir}</dd>
            <dt>Index</dt>
            <dd>{status.storage.indexHealthy ? "healthy" : "unhealthy"}</dd>
          </dl>
        {:else if error}
          <p class="error">{error}</p>
        {:else}
          <p class="muted">Loading orchestrator status…</p>
        {/if}
      </div>
    </div>

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
    display: grid;
    place-items: center;
    padding: 32px;
    background:
      radial-gradient(circle at 20% 0%, rgb(56 189 248 / 16%), transparent 32rem),
      radial-gradient(circle at 90% 10%, rgb(129 140 248 / 12%), transparent 28rem),
      var(--color-bg);
  }

  .hero-card {
    width: min(1080px, 100%);
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
    margin-bottom: 32px;
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

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
    gap: 32px;
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
  .event-strip {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: rgb(11 16 32 / 72%);
    padding: 22px;
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

  .event-strip {
    margin-top: 28px;
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

  @media (max-width: 780px) {
    .hero-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
