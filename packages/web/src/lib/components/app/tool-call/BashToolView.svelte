<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import LogLineList from "./LogLineList.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "bash" }> };
  let { toolCall, view }: Props = $props();
</script>

{#if view.tailLines.length > 0}
  <LogLineList lines={view.tailLines} />
{:else if toolCall.status === "running"}
  <p class="note live-note">Waiting for command output…</p>
{/if}

{#if view.live}
  <p class="note live-note">Streaming live output…</p>
{/if}

{#if view.savedTo}
  <p class="note">Full output saved to <span class="path">{view.savedTo}</span></p>
{/if}

<style>
  .note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }

  .path {
    font-family: var(--font-mono);
  }
</style>
