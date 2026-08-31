<script lang="ts">
import type { StatusResponse } from "$lib/api";
import { formatDurationMinutes } from "@nervekit/ui-kit/display/usage";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverProperties,
  PopoverProperty,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import { type StatusTone } from "@nervekit/ui-kit/display/status";

type Props = {
  connection?: string;
  live?: boolean;
  status?: StatusResponse;
  side?: "top" | "bottom";
  /** Phone widths: show the dot alone; the popover carries the detail. */
  compact?: boolean;
};

let {
  connection = "connecting",
  live = false,
  status,
  side = "top",
  compact = false,
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
  size="sm"
  triggerClass="h-5.5 rounded-sm px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
  ariaLabel="Open daemon status"
  {side}
  align="end"
>
  {#snippet trigger()}
    <span class="status-trigger" title={`Nerve daemon · ${summary}`}>
      <StatusDot tone={connectionTone} pulse={live} />
      {#if !compact}<span>{summary}</span>{/if}
    </span>
  {/snippet}

  <PopoverBody>
    <PopoverHeader title="Nerve daemon">
      {#snippet action()}
        <Badge size="xs" tone={connectionTone}>{summary}</Badge>
      {/snippet}
    </PopoverHeader>

    <PopoverProperties>
      <PopoverProperty label="Connection">
        <span class="flex items-center gap-1.5">
          <StatusDot tone={connectionTone} size="xs" />{connection}
        </span>
      </PopoverProperty>
      <PopoverProperty
        label="Version"
        value={status?.version}
        valueClass="font-mono"
      />
      <PopoverProperty label="Uptime" value={uptime ?? undefined} />
      <PopoverProperty
        label="Index"
        value={status == null
          ? undefined
          : status.storage.indexHealthy
            ? "healthy"
            : "rebuilding"}
        valueClass={status?.storage.indexHealthy
          ? "text-success"
          : "text-warning"}
      />
      <PopoverProperty
        label="Data dir"
        value={status?.storage.home}
        valueClass="font-mono"
        title={status?.storage.home}
      />
    </PopoverProperties>
  </PopoverBody>
</Popover>

<style>
.status-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
</style>
