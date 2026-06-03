<script lang="ts">
  import type { ProcessLogQueryResponse } from "../../api";
  import { logLevelTone } from "../../utils/status";
  import { timeLabel } from "../../utils/time";
  import { StatusDot } from "$lib/components/ui/status-dot";

  type Props = {
    processLogs?: ProcessLogQueryResponse;
  };

  let { processLogs }: Props = $props();
</script>

<div class="log-terminal" role="log" aria-label="Process output" aria-live="polite">
  {#if (processLogs?.events ?? []).length === 0}
    <code><span class="seq">--</span><span class="time">--:--:--</span><span class="stream">--</span><span class="line">No logs captured.</span></code>
  {/if}
  {#each processLogs?.events ?? [] as event}
    <code class={event.level}>
      <span class="seq">#{event.seq}</span>
      <span class="time">{timeLabel(event.ts)}</span>
      <span class="stream"><StatusDot size="xs" tone={logLevelTone(event.level)} />{event.stream}</span>
      <span class="line">{event.line}</span>
    </code>
  {/each}
</div>

<style>
  .log-terminal {
    display: grid;
    align-content: start;
    gap: 0.12rem;
    height: 100%;
    min-height: 0;
    overflow: auto;
    background: var(--sidebar);
    padding: 0.5rem 0.75rem;
  }

  code {
    display: grid;
    grid-template-columns: 3.6rem 5.1rem 4.8rem minmax(0, 1fr);
    align-items: start;
    gap: 0.5rem;
    min-width: max-content;
    color: color-mix(in oklab, var(--foreground) 92%, transparent);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .seq {
    color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
  }

  .time {
    color: var(--success);
  }

  .stream {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    color: var(--muted-foreground);
  }

  .line {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  code.warn .line {
    color: var(--warning);
  }

  code.error .line {
    color: var(--destructive);
  }
</style>
