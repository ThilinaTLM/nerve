<script lang="ts">
  import type { ProcessLogQueryResponse } from "../../../api";
  import StatusDot from "../../ui/StatusDot.svelte";
  import { logLevelTone } from "../../../utils/status";
  import { timeLabel } from "../../../utils/time";

  type Props = {
    processLogs?: ProcessLogQueryResponse;
  };

  let { processLogs }: Props = $props();
</script>

<div class="log-terminal" role="log" aria-label="Process logs">
  {#if (processLogs?.events ?? []).length === 0}
    <code><span class="seq">--</span><span class="time">--:--:--</span><span class="line">No logs captured.</span></code>
  {/if}
  {#each processLogs?.events ?? [] as event}
    <code class={event.level}>
      <span class="seq">#{event.seq}</span>
      <span class="time">{timeLabel(event.ts)}</span>
      <StatusDot size="xs" tone={logLevelTone(event.level)} />
      <span class="line">{event.line}</span>
    </code>
  {/each}
</div>
