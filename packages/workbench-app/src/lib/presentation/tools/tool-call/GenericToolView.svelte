<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import ToolArgumentBody from "./ToolArgumentBody.svelte";
import ToolSections from "./ToolSections.svelte";

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
const showArgs = $derived(
  view.args.length > 0 &&
    (toolCall.status === "failed" ||
      toolCall.status === "denied" ||
      toolCall.status === "cancelled"),
);
const hasResult = $derived(Boolean(view.resultText) || Boolean(resultBody));
</script>

{#if hasResult || showArgs || toolCall.status === "completed"}
  <ToolSections>
    {#if view.resultText}
      <div class="px-2.5 py-2" aria-label="Recorded tool output">
        <p class="m-0 mb-1 text-ui font-medium text-muted-foreground">Result</p>
        <p
          class="m-0 whitespace-pre-wrap text-ui leading-relaxed text-foreground [overflow-wrap:anywhere]"
          class:line-clamp-6={!expanded}
        >
          {view.resultText}
        </p>
      </div>
    {:else if resultBody}
      <div class="px-2.5 py-2" aria-label="Recorded tool output">
        <ToolArgumentBody body={resultBody} />
      </div>
    {:else if toolCall.status === "completed"}
      <div class="px-2.5 py-2 text-ui text-muted-foreground">No output.</div>
    {/if}

    {#if showArgs}
      <div class="px-2.5 py-2">
        <p class="m-0 mb-1 text-ui font-medium text-muted-foreground">
          Recorded arguments
        </p>
        <ToolArgumentBody body={argsBody} />
      </div>
    {/if}
  </ToolSections>
{/if}
