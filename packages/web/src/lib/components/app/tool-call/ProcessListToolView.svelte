<script lang="ts">
  import { StatusDot } from "../../ui/status-dot";
  import type { ToolCallRecord } from "../../../api";
  import { processTone, processUrl } from "../../../tool-views/process";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "process_list" }> };
  let { view }: Props = $props();
</script>

{#if view.processes.length === 0}
  <p class="note">No managed processes.</p>
{:else}
  <ul class="proc-list">
    {#each view.processes as process (process.id)}
      {@const url = processUrl(process)}
      <li>
        <StatusDot tone={processTone(process.status)} />
        <span class="name">{process.name ?? process.command}</span>
        <span class="status">{process.status}</span>
        {#if url}<a class="url" href={url} target="_blank" rel="noreferrer noopener">{url}</a>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .proc-list {
    margin: 0;
    list-style: none;
    display: grid;
    gap: 0.3rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    font-size: var(--text-xs);
  }

  .proc-list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .name {
    font-family: var(--font-mono);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    color: var(--muted-foreground);
    text-transform: capitalize;
  }

  .url {
    margin-left: auto;
    font-family: var(--font-mono);
    color: var(--info);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
