<script lang="ts">
import type { StatusResponse } from "$lib/api";
import { formatDurationMinutes } from "@nervekit/workbench-ui/core/utils/usage";
import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
import Popover from "@nervekit/workbench-ui/components/ui/popover-panel";
import { StatusDot } from "@nervekit/workbench-ui/components/ui/status-dot";
import { type StatusTone } from "@nervekit/workbench-ui/core/utils/status";

type Props = {
  connection?: string;
  live?: boolean;
  status?: StatusResponse;
  side?: "top" | "bottom";
};

let {
  connection = "connecting",
  live = false,
  status,
  side = "top",
}: Props = $props();

const connectionTone = $derived<StatusTone>(
  live
    ? "good"
    : connection === "error"
      ? "danger"
      : connection === "closed"
        ? "warn"
        : "running",
);
const summary = $derived(live ? "Connected" : connection);

const uptime = $derived.by(() => {
  if (!status?.startedAt) return null;
  const started = new Date(status.startedAt).getTime();
  if (Number.isNaN(started)) return null;
  return formatDurationMinutes((Date.now() - started) / 60_000);
});
</script>

<Popover
  class="status-popover"
  triggerClass="status-trigger-wrap"
  ariaLabel="Open daemon status"
  {side}
  align="end"
>
  {#snippet trigger()}
    <span class="status-trigger" title="Open daemon status">
      <StatusDot tone={connectionTone} pulse={live} />
      <span>{summary}</span>
    </span>
  {/snippet}

  <div class="flex flex-col gap-3 p-3">
    <header
      class="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5"
    >
      <strong class="text-sm font-semibold">Nerve daemon</strong>
      <Badge size="xs" tone={connectionTone}>{summary}</Badge>
    </header>

    <dl class="flex flex-col gap-2 text-xs">
      <div class="flex items-center justify-between gap-3">
        <dt class="text-muted-foreground">Connection</dt>
        <dd class="flex items-center gap-1.5 font-medium">
          <StatusDot tone={connectionTone} size="xs" />{connection}
        </dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-muted-foreground">Version</dt>
        <dd class="font-mono">{status?.version ?? "—"}</dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-muted-foreground">Uptime</dt>
        <dd class="font-medium">{uptime ?? "—"}</dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-muted-foreground">Index</dt>
        <dd
          class={status?.storage.indexHealthy ? "text-success" : "text-warning"}
        >
          {status == null
            ? "—"
            : status.storage.indexHealthy
              ? "healthy"
              : "rebuilding"}
        </dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-muted-foreground">Home</dt>
        <dd class="min-w-0 truncate font-mono" title={status?.storage.home}>
          {status?.storage.home ?? "—"}
        </dd>
      </div>
    </dl>
  </div>
</Popover>

<style>
.status-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 100%;
  color: var(--muted-foreground);
  padding: 0 0.6rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
}

/* Compound selector outweighs the shared `.popover-content` width default. */
:global(.popover-content.status-popover) {
  width: 16rem;
}

:global(.status-trigger-wrap) {
  height: 100%;
}

:global(.status-trigger-wrap:hover),
:global(.status-trigger-wrap[data-state="open"]) {
  background: var(--accent);
}

:global(.status-trigger-wrap:hover) .status-trigger,
:global(.status-trigger-wrap[data-state="open"]) .status-trigger {
  color: var(--foreground);
}
</style>
