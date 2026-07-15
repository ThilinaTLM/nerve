<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "generic" }>;
};

let { toolCall, view }: Props = $props();

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
    <ToolArgumentBody
      body={{ kind: "text-summary", text: view.resultText, label: "Result" }}
    />
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
