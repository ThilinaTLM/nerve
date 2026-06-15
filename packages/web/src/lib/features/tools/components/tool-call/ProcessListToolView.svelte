<script lang="ts">
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { ToolCallRecord } from "$lib/api";
  import { processTone, processUrl } from "$lib/features/tools/views/process";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "process_list" }> };
  let { view }: Props = $props();

  const envMeta = (process: { envInfo?: { keys: string[] } }) => {
    const count = process.envInfo?.keys.length ?? 0;
    return count > 0 ? `env ${count} redacted` : undefined;
  };
  const envKeys = (process: { envInfo?: { keys: string[] } }) => process.envInfo?.keys.join(", ");
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
        {#if process.runtime?.childPid}
          <span class="meta">pid {process.runtime.childPid}</span>
        {/if}
        {#if process.runtime?.processGroupId}
          <span class="meta">pgid {process.runtime.processGroupId}</span>
        {/if}
        {#if process.status === "orphaned" && process.runtime?.platform}
          <span class="meta">{process.runtime.platform}</span>
        {/if}
        {#if envMeta(process)}
          <span class="meta" title={envKeys(process)}>{envMeta(process)}</span>
        {/if}
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

  .meta {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
    white-space: nowrap;
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
