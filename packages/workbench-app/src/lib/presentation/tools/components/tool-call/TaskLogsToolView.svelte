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
let { toolCall, view, expanded = false }: Props = $props();

const visible = $derived(
  expanded ? view.events : tail(view.events, COLLAPSED_LINES),
);
</script>

{#if view.previewUnavailable && toolCall.status === "completed"}
  <p class="m-0 text-xs text-warning">
    Log preview is incomplete. Open Details to inspect the full result.
  </p>
{/if}

{#if view.events.length > 0}
  <div
    class="terminal-output rounded-sm border bg-sidebar px-2.5 py-1.5 font-mono text-xs text-sidebar-foreground"
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
{:else if toolCall.status === "completed" && !view.previewUnavailable}
  <p class="m-0 text-xs text-muted-foreground">
    No matching log events{view.task
      ? ` for ${view.task.name ?? view.task.id} (${view.task.status})`
      : ""}.
  </p>
{/if}
