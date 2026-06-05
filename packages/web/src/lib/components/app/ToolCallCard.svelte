<script lang="ts">
  import type { ToolCallRecord } from "../../api";
  import type { LiveToolOutput } from "../../stores/workbench/state.svelte";
  import { parseToolView } from "../../tool-views/tool-result-view";
  import { toolViewComponent } from "../../tool-views/registry";
  import { trimTextPreview } from "../../utils/text-preview";

  type Props = { toolCall: ToolCallRecord; liveOutput?: LiveToolOutput };
  let { toolCall, liveOutput }: Props = $props();

  const view = $derived(parseToolView(toolCall, liveOutput));
  const ToolView = $derived(toolViewComponent(view.kind));

  const statusLabel: Partial<Record<ToolCallRecord["status"], string>> = {
    requested: "requested",
    pending_approval: "awaiting approval",
    waiting_for_user: "awaiting reply",
    running: "running",
    denied: "denied",
    error: "error",
  };

  const title = $derived("title" in view ? view.title : undefined);
  const bashStatus = $derived(
    view.kind === "bash" && view.exitCode !== undefined && view.exitCode !== 0
      ? `failed · exit ${view.exitCode}`
      : view.kind === "bash" && view.signal
        ? `signal ${view.signal}`
        : undefined,
  );
  const visibleStatus = $derived(statusLabel[toolCall.status] ?? bashStatus);
  const visibleStatusClass = $derived(
    bashStatus?.startsWith("failed")
      ? "status-error"
      : bashStatus?.startsWith("signal")
        ? "status-warning"
        : `status-${toolCall.status}`,
  );
  const errorPreview = $derived(toolCall.error ? trimTextPreview(toolCall.error, { headLines: 18, tailLines: 6, maxChars: 6_000 }).text : "");
</script>

<article class={`tool-card status-${toolCall.status}`}>
  <div class="tool-head">
    <span class="tool-name">{toolCall.toolName}</span>
    {#if title}
      <span class="tool-title" title={title}>{title}</span>
    {/if}
    {#if visibleStatus}
      <span class={`tool-status ${visibleStatusClass}`}>{visibleStatus}</span>
    {/if}
  </div>

  {#if toolCall.error}
    <pre class="tool-pre error">{errorPreview}</pre>
  {/if}

  <ToolView {toolCall} {view} />
</article>

<style>
  .tool-card {
    display: grid;
    gap: 0.45rem;
    width: 100%;
    padding: 0.65rem 0.75rem;
    border-bottom: 0;
  }

  .tool-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    min-width: 0;
  }

  .tool-name {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--foreground);
  }

  .tool-title {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 8rem;
  }

  .tool-status {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--muted-foreground);
    flex: none;
  }

  .tool-status.status-running,
  .tool-status.status-requested,
  .tool-status.status-pending_approval,
  .tool-status.status-waiting_for_user,
  .tool-status.status-warning {
    color: var(--warning);
  }

  .tool-status.status-error,
  .tool-status.status-denied {
    color: var(--destructive);
  }

  .tool-pre {
    margin: 0;
    overflow: visible;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.48rem 0.58rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-pre.error {
    border-color: color-mix(in oklab, var(--destructive) 40%, var(--border));
    color: var(--destructive);
  }
</style>
