<script lang="ts">
import type { StatusResponse } from "$lib/api";
import { formatDurationMinutes } from "@nervekit/ui-kit/display/usage";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverProperties,
  PopoverProperty,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import { type StatusTone } from "@nervekit/ui-kit/display/status";
import { STATUS_BAR_CHIP_BUTTON } from "$lib/presentation/shell";

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
    ? "success"
    : connection === "error"
      ? "destructive"
      : connection === "closed"
        ? "warning"
        : "info",
);
// The status-bar chip that opens this panel is the connection indicator, so
// the panel states version and health instead of repeating it.
const summary = $derived(live ? "Connected" : connection);
const versionLabel = $derived(
  status?.version ? `v${status.version}` : undefined,
);

const uptime = $derived.by(() => {
  if (!status?.startedAt) return null;
  const started = new Date(status.startedAt).getTime();
  if (Number.isNaN(started)) return null;
  return formatDurationMinutes((Date.now() - started) / 60_000);
});
</script>

<Popover
  size="sm"
  triggerClass={STATUS_BAR_CHIP_BUTTON}
  ariaLabel="Open daemon status"
  {side}
  align="end"
>
  {#snippet trigger()}
    <span
      class="inline-flex items-center gap-1.5"
      title={`Nerve daemon · ${summary}`}
    >
      <StatusDot tone={connectionTone} pulse={live} />
      {#if !compact}<span>{summary}</span>{/if}
    </span>
  {/snippet}

  <PopoverHeader title="Nerve daemon" meta={versionLabel} />

  <PopoverBody>
    <PopoverProperties>
      <PopoverProperty label="Uptime" value={uptime ?? undefined} />
      <PopoverProperty
        label="Index"
        value={status == null
          ? undefined
          : status.storage.indexHealthy
            ? "Healthy"
            : "Rebuilding"}
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
