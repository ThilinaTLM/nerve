<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { ToolCallRecord } from "$lib/api";
  import { processTone, processUrl } from "$lib/features/tools/views/process";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "process_action" }> };
  let { view }: Props = $props();

  const process = $derived(view.process);
  const url = $derived(process ? processUrl(process) : undefined);
  const envMeta = $derived(process?.envInfo?.keys.length ? `env ${process.envInfo.keys.length} redacted` : undefined);
  const envKeys = $derived(process?.envInfo?.keys.join(", "));
</script>

{#if process}
  <div class="flex items-center gap-2">
    <StatusDot tone={processTone(process.status)} pulse={process.status === "starting" || process.status === "stopping"} />
    <span class="text-sm font-semibold capitalize">{process.status}</span>
    {#if process.exitCode !== undefined && process.exitCode !== null}
      <span class="font-mono text-xs text-muted-foreground">exit {process.exitCode}</span>
    {/if}
    {#if process.signal}
      <span class="font-mono text-xs text-muted-foreground">signal {process.signal}</span>
    {/if}
    {#if process.runtime?.childPid}
      <span class="font-mono text-xs text-muted-foreground">pid {process.runtime.childPid}</span>
    {/if}
    {#if process.runtime?.processGroupId}
      <span class="font-mono text-xs text-muted-foreground">pgid {process.runtime.processGroupId}</span>
    {/if}
    {#if process.status === "orphaned" && process.runtime?.platform}
      <span class="font-mono text-xs text-muted-foreground">{process.runtime.platform}</span>
    {/if}
    {#if envMeta}
      <span class="font-mono text-xs text-muted-foreground" title={envKeys}>{envMeta}</span>
    {/if}
  </div>
  <p class="m-0 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{process.command}</p>
  {#if url}
    <a class="inline-flex items-center gap-1 font-mono text-xs text-info hover:underline" href={url} target="_blank" rel="noreferrer noopener">
      <ExternalLink size={12} strokeWidth={2} />{url}
    </a>
  {/if}
  {#if process.error}
    <p class="m-0 text-xs text-destructive">{process.error}</p>
  {/if}
{/if}
