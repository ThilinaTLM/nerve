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
  <p class="m-0 text-xs text-muted-foreground">No managed processes.</p>
{:else}
  <ul class="m-0 grid list-none gap-1 rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-sidebar-foreground">
    {#each view.processes as process (process.id)}
      {@const url = processUrl(process)}
      <li class="flex min-w-0 items-center gap-2">
        <StatusDot tone={processTone(process.status)} />
        <span class="truncate font-mono font-semibold">{process.name ?? process.command}</span>
        <span class="capitalize text-muted-foreground">{process.status}</span>
        {#if process.runtime?.childPid}
          <span class="whitespace-nowrap font-mono text-muted-foreground">pid {process.runtime.childPid}</span>
        {/if}
        {#if process.runtime?.processGroupId}
          <span class="whitespace-nowrap font-mono text-muted-foreground">pgid {process.runtime.processGroupId}</span>
        {/if}
        {#if process.status === "orphaned" && process.runtime?.platform}
          <span class="whitespace-nowrap font-mono text-muted-foreground">{process.runtime.platform}</span>
        {/if}
        {#if envMeta(process)}
          <span class="whitespace-nowrap font-mono text-muted-foreground" title={envKeys(process)}>{envMeta(process)}</span>
        {/if}
        {#if url}<a class="ml-auto truncate font-mono text-info" href={url} target="_blank" rel="noreferrer noopener">{url}</a>{/if}
      </li>
    {/each}
  </ul>
{/if}
