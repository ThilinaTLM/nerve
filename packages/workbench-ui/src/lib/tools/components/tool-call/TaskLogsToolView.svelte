<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { COLLAPSED_LINES, tail } from "../../views/tool-result-view";
import TerminalText from "./TerminalText.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "task_logs" }>;
  expanded?: boolean;
};
let { view, expanded = false }: Props = $props();

const visible = $derived(
  expanded ? view.events : tail(view.events, COLLAPSED_LINES),
);
</script>

{#if view.events.length === 0}
  <p class="m-0 text-xs text-muted-foreground">No log events.</p>
{:else}
  <div
    class="terminal-output rounded-sm border bg-sidebar px-2.5 py-1.5 font-mono text-xs leading-[1.22] text-sidebar-foreground"
  >
    {#each visible as event (event.seq)}
      <div
        class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"
        class:text-warning={event.level === "warn"}
        class:text-destructive={event.level === "error"}
      >
        <span class="text-right text-muted-foreground">{event.seq}</span>
        <span class="whitespace-pre-wrap break-words"
          ><TerminalText
            text={event.line || "\u00A0"}
            stream={event.stream}
            level={event.level}
          /></span
        >
      </div>
    {/each}
  </div>
{/if}
