<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "generic" }>;
  expanded?: boolean;
};

let { toolCall, view, expanded = false }: Props = $props();

const resultBody = $derived(
  view.result.length > 0
    ? {
        kind: "key-values" as const,
        items: view.result.map((entry) => ({
          label: entry.key,
          value: entry.value,
          mono: true,
          tone: entry.redacted ? ("warning" as const) : undefined,
        })),
      }
    : undefined,
);
const argsBody = $derived({
  kind: "key-values" as const,
  items: view.args.map((entry) => ({
    label: entry.key,
    value: entry.value,
    mono: true,
    tone: entry.redacted ? ("warning" as const) : undefined,
  })),
});
</script>

<div class="grid gap-2" aria-label="Recorded tool output">
  {#if view.resultText}
    <div class="grid gap-1.5">
      <p class="m-0 text-xs font-medium text-muted-foreground">Result</p>
      <p
        class="m-0 whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]"
        class:line-clamp-6={!expanded}
      >
        {view.resultText}
      </p>
    </div>
  {:else if resultBody}
    <ToolArgumentBody body={resultBody} />
  {:else if toolCall.status === "completed"}
    <p class="m-0 text-xs text-muted-foreground">No output.</p>
  {/if}

  {#if view.args.length > 0 && (toolCall.status === "error" || toolCall.status === "denied")}
    <div class="grid gap-1.5">
      <p class="m-0 text-xs font-medium text-muted-foreground">
        Recorded arguments
      </p>
      <ToolArgumentBody body={argsBody} />
    </div>
  {/if}
</div>
