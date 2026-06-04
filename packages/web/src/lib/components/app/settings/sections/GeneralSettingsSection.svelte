<script lang="ts">
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import type { StatusResponse } from "../../../../api";

  type Props = {
    status?: StatusResponse;
  };

  let { status }: Props = $props();
</script>

<section class="settings-card app-card" data-section="general">
  <div class="card-head">
    <div class="card-icon"><Settings2 size={16} strokeWidth={2.2} /></div>
    <div>
      <span class="eyebrow">General</span>
      <h2>Daemon state</h2>
      <p>Read-only runtime metadata from the orchestrator.</p>
    </div>
  </div>
  <div class="stat-grid">
    <section class="app-surface"><span>Daemon</span><strong>{status?.daemonId ?? "not loaded"}</strong></section>
    <section class="app-surface"><span>Version</span><strong>{status?.version ?? "—"}</strong></section>
    <section class="app-surface">
      <span>Started</span><strong>{status?.startedAt ? new Date(status.startedAt).toLocaleString() : "—"}</strong>
    </section>
    <section class="app-surface"><span>Index</span><strong>{status?.storage.indexHealthy ? "healthy" : "unknown"}</strong></section>
    <section class="wide app-surface"><span>Data directory</span><strong title={status?.dataDir}>{status?.dataDir ?? "—"}</strong></section>
    <section class="wide app-surface">
      <span>SQLite</span><strong title={status?.storage.sqlitePath}>{status?.storage.sqlitePath ?? "—"}</strong>
    </section>
  </div>
</section>
