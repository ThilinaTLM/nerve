<script lang="ts">
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
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
  {#if view.code && inlineCodeIsMultiline}
    <section class="grid gap-1" aria-label="Python script">
      <ToolOutputBlock text={view.code} language="python" {expanded} />
    </section>
  {/if}

  {#if view.output.length > 0}
    <section class="grid gap-1" aria-label="Python output">
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
    <p class="m-0 text-xs text-muted-foreground">Waiting for Python output…</p>
  {:else if toolCall.status === "completed" && (view.inputMode === "file" || (view.code && view.code.length > 0))}
    <section class="grid gap-1" aria-label="Python output">
      <p class="m-0 text-xs text-muted-foreground">No Python output.</p>
    </section>
  {/if}

  {#if view.live}
    <p class="m-0 text-xs text-muted-foreground">Streaming live output…</p>
  {/if}
</div>
