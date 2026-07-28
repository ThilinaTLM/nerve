<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "python" }>;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const inlineCodeIsMultiline = $derived(
  view.inputMode !== "file" && Boolean(view.code?.match(/[\r\n]/)),
);
</script>

<div class="grid gap-1.5">
  {#if expanded && view.code && inlineCodeIsMultiline}
    <section class="grid gap-1" aria-label="Python script">
      <ToolOutputBlock text={view.code} language="python" {expanded} />
    </section>
  {/if}

  {#if view.output.length > 0}
    <section class="grid gap-1" aria-label="Python output">
      <ToolOutputBlock
        text={view.output}
        direction="tail"
        {expanded}
        outputLimits={view.outputLimits}
        terminal
      />
    </section>
  {:else if toolCall.status === "completed"}
    <section class="grid gap-1" aria-label="Python output">
      <p class="m-0 text-xs text-muted-foreground">No output.</p>
    </section>
  {/if}
</div>
