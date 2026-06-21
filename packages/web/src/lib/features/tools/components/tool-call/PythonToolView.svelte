<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "python" }>;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();
</script>

<div class="grid gap-1.5">
  {#if view.inputMode === "file" && view.relScriptPath}
    <p class="m-0 text-xs text-muted-foreground">
      Python script file: <code class="font-mono text-foreground">{view.relScriptPath}</code>
    </p>
  {:else if view.code && view.code.length > 0}
    <section class="grid gap-1" aria-label="Python script">
      <ToolOutputBlock text={view.code} language="python" {expanded} />
    </section>
  {/if}

  {#if view.output.length > 0}
    <section class="grid gap-1" aria-label="Python output">
      <ToolOutputBlock text={view.output} direction="tail" {expanded} />
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
