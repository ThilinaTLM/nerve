<script lang="ts">
  import type { ProcessLogEvent } from "$lib/api";

  type LineItem = { text: string; level?: ProcessLogEvent["level"]; stream?: ProcessLogEvent["stream"] };

  type Props = {
    events?: ProcessLogEvent[];
    lines?: string[];
    maxHeight?: string;
  };
  let { events, lines, maxHeight = "16rem" }: Props = $props();

  const items = $derived<LineItem[]>(
    events
      ? events.map((event) => ({ text: event.line, level: event.level, stream: event.stream }))
      : (lines ?? []).map((text) => ({ text })),
  );
</script>

<div class="log-list" style:max-height={maxHeight}>
  {#each items as item, index (index)}
    <div class={`log-line${item.level ? ` level-${item.level}` : ""}${item.stream === "stderr" ? " stderr" : ""}`}>{item.text || "\u00A0"}</div>
  {/each}
</div>

<style>
  .log-list {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.42rem 0.55rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .log-line {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .log-line.stderr {
    color: color-mix(in oklab, var(--muted-foreground) 90%, var(--foreground));
  }

  .log-line.level-warn {
    color: var(--warning);
  }

  .log-line.level-error {
    color: var(--destructive);
  }
</style>
