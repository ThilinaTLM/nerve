<script lang="ts">
  import type { StatusResponse } from "$lib/api";

  type Props = {
    status?: StatusResponse;
  };

  let { status }: Props = $props();
</script>

<section id="settings-runtime" class="settings-section settings-section-muted" data-section="runtime">
  <header class="settings-section-header">
    <h2>Diagnostics</h2>
  </header>
  <div class="settings-section-body">
    <div class="stat-grid">
      <section><span>Daemon</span><strong>{status?.daemonId ?? "not loaded"}</strong></section>
      <section><span>Version</span><strong>{status?.version ?? "—"}</strong></section>
      <section>
        <span>Started</span><strong>{status?.startedAt ? new Date(status.startedAt).toLocaleString() : "—"}</strong>
      </section>
      <section><span>Index</span><strong>{status?.storage.indexHealthy ? "healthy" : "unknown"}</strong></section>
      <section class="wide"><span>Data directory</span><strong title={status?.dataDir}>{status?.dataDir ?? "—"}</strong></section>
      <section class="wide">
        <span>SQLite</span><strong title={status?.storage.sqlitePath}>{status?.storage.sqlitePath ?? "—"}</strong>
      </section>
    </div>
  </div>
</section>
