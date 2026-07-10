<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "bash" }>;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const commandIsMultiline = $derived(Boolean(view.command?.match(/[\r\n]/)));
</script>

<div class="grid gap-1.5">
  {#if view.command && commandIsMultiline}
    <section class="grid gap-1" aria-label="Bash command">
      <ToolOutputBlock text={view.command} language="bash" {expanded} />
    </section>
  {/if}

  {#if view.output.length > 0}
    <section class="grid gap-1" aria-label="Command output">
      <ToolOutputBlock
        text={view.output}
        direction="tail"
        collapsedLines={10}
        {expanded}
        outputLimits={view.outputLimits}
        terminal
      />
    </section>
  {:else if toolCall.status === "running"}
    <p class="m-0 text-xs text-muted-foreground">Waiting for command output…</p>
  {/if}

  {#if view.live}
    <p class="m-0 text-xs text-muted-foreground">Streaming live output…</p>
  {/if}
</div>
