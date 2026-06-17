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

{#if view.code && view.code.length > 0}
  <section class="section" aria-label="Python script">
    <ToolOutputBlock text={view.code} language="python" {expanded} />
  </section>
{/if}

{#if view.output.length > 0}
  <section class="section" aria-label="Python output">
    <ToolOutputBlock text={view.output} direction="tail" {expanded} />
  </section>
{:else if toolCall.status === "running"}
  <p class="note">Waiting for Python output…</p>
{:else if toolCall.status === "completed" && view.code && view.code.length > 0}
  <section class="section" aria-label="Python output">
    <p class="note">No Python output.</p>
  </section>
{/if}

{#if view.live}
  <p class="note">Streaming live output…</p>
{/if}

<style>
  .section {
    display: grid;
    gap: 0.25rem;
  }

  .section + .section,
  .section + .note,
  .note + .note {
    margin-top: 0.4rem;
  }

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
