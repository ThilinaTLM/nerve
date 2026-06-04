<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { StatusDot } from "../../ui/status-dot";
  import type { ToolCallRecord } from "../../../api";
  import { processTone, processUrl } from "../../../tool-views/process";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "process_action" }> };
  let { view }: Props = $props();

  const process = $derived(view.process);
  const url = $derived(process ? processUrl(process) : undefined);
</script>

{#if process}
  <div class="row">
    <StatusDot tone={processTone(process.status)} pulse={process.status === "starting" || process.status === "stopping"} />
    <span class="status">{process.status}</span>
    {#if process.exitCode !== undefined && process.exitCode !== null}
      <span class="meta">exit {process.exitCode}</span>
    {/if}
    {#if process.signal}
      <span class="meta">signal {process.signal}</span>
    {/if}
  </div>
  <p class="command">{process.command}</p>
  {#if url}
    <a class="url" href={url} target="_blank" rel="noreferrer noopener">
      <ExternalLink size={12} strokeWidth={2} />{url}
    </a>
  {/if}
  {#if process.error}
    <p class="error">{process.error}</p>
  {/if}
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .status {
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }

  .command {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted-foreground);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .url {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--info);
  }

  .url:hover {
    text-decoration: underline;
  }

  .error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--destructive);
  }
</style>
