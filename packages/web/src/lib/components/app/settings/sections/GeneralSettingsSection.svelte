<script lang="ts">
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import type { StatusResponse } from "../../../../api";
  import * as Card from "$lib/components/ui/card";

  type Props = {
    status?: StatusResponse;
  };

  let { status }: Props = $props();
</script>

<Card.Root size="sm" data-section="general">
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <Settings2 size={16} strokeWidth={2.2} /> Daemon state
    </Card.Title>
    <Card.Description>Read-only runtime metadata from the orchestrator.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-3">
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
  </Card.Content>
</Card.Root>
