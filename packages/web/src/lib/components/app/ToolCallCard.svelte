<script lang="ts">
  import type { ToolCallRecord } from "../../api";
  import { parseToolView } from "../../tool-views/tool-result-view";
  import { toolIcon, toolViewComponent } from "../../tool-views/registry";
  import Disclosure from "./tool-call/Disclosure.svelte";
  import ResultCodeBlock from "./tool-call/ResultCodeBlock.svelte";

  type Props = { toolCall: ToolCallRecord };
  let { toolCall }: Props = $props();

  const view = $derived(parseToolView(toolCall));
  const Icon = $derived(toolIcon(toolCall.toolName));
  const ToolView = $derived(toolViewComponent(view.kind));
  const running = $derived(toolCall.status === "running" || toolCall.status === "requested");

  const statusLabel: Record<ToolCallRecord["status"], string> = {
    requested: "requested",
    pending_approval: "awaiting approval",
    waiting_for_user: "awaiting reply",
    running: "running",
    completed: "completed",
    denied: "denied",
    error: "error",
  };

  function stringify(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  const title = $derived("title" in view ? view.title : undefined);
  const argsText = $derived(stringify(toolCall.args));
  const rawResultText = $derived(stringify(toolCall.result));
  const hasArgs = $derived(argsText.trim().length > 0 && argsText.trim() !== "{}");
  const hasRawResult = $derived(!toolCall.error && rawResultText.trim().length > 0);
</script>

<article class={`tool-card status-${toolCall.status}`}>
  <div class="tool-gutter">
    <span class="tool-icon" class:running title={toolCall.toolName}>
      <Icon size={13} strokeWidth={2.1} />
    </span>
  </div>
  <div class="tool-body">
    <div class="tool-head">
      <span class="tool-name">{toolCall.toolName}</span>
      {#if title}
        <span class="tool-title" title={title}>{title}</span>
      {/if}
      <span class={`tool-status status-${toolCall.status}`}>{statusLabel[toolCall.status]}</span>
      <span class="tool-risk">{toolCall.risk.replace("_", " ")}</span>
    </div>

    {#if toolCall.error}
      <pre class="tool-pre error">{toolCall.error}</pre>
    {/if}

    <ToolView {toolCall} {view} />

    {#if hasArgs}
      <Disclosure label="arguments">
        <ResultCodeBlock code={argsText} language="json" />
      </Disclosure>
    {/if}

    {#if hasRawResult}
      <Disclosure label="raw result">
        <ResultCodeBlock code={rawResultText} language="json" />
      </Disclosure>
    {/if}
  </div>
</article>

<style>
  .tool-card {
    display: grid;
    grid-template-columns: 1.8rem minmax(0, 1fr);
    gap: 0.55rem;
    width: 100%;
    max-width: 920px;
    margin: 0 auto;
    padding: 0.65rem 0;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  }

  .tool-gutter {
    display: grid;
    justify-items: center;
    padding-top: 0.1rem;
  }

  .tool-icon {
    display: inline-grid;
    width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--muted);
    color: var(--muted-foreground);
  }

  .tool-card.status-completed .tool-icon {
    border-color: color-mix(in oklab, var(--success) 45%, var(--border));
    color: var(--success);
  }

  .tool-card.status-error .tool-icon,
  .tool-card.status-denied .tool-icon {
    border-color: color-mix(in oklab, var(--destructive) 45%, var(--border));
    color: var(--destructive);
  }

  .tool-icon.running {
    color: var(--primary);
    animation: tool-pulse 1.1s ease-in-out infinite;
  }

  .tool-body {
    min-width: 0;
    display: grid;
    gap: 0.4rem;
    align-content: start;
  }

  .tool-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    min-width: 0;
    padding-top: 0.18rem;
  }

  .tool-name {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .tool-title {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    flex: 1 1 auto;
    min-width: 0;
  }

  .tool-status {
    border-radius: 999px;
    padding: 0.06rem 0.45rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: lowercase;
    border: 1px solid var(--border);
    background: var(--muted);
    color: var(--muted-foreground);
    flex: none;
  }

  .tool-status.status-running,
  .tool-status.status-requested,
  .tool-status.status-pending_approval,
  .tool-status.status-waiting_for_user {
    border-color: color-mix(in oklab, var(--warning) 40%, var(--border));
    background: color-mix(in oklab, var(--warning) 18%, transparent);
    color: var(--warning);
  }

  .tool-status.status-completed {
    border-color: color-mix(in oklab, var(--success) 40%, var(--border));
    background: color-mix(in oklab, var(--success) 16%, transparent);
    color: var(--success);
  }

  .tool-status.status-error,
  .tool-status.status-denied {
    border-color: color-mix(in oklab, var(--destructive) 40%, var(--border));
    background: color-mix(in oklab, var(--destructive) 16%, transparent);
    color: var(--destructive);
  }

  .tool-risk {
    font-size: 0.6875rem;
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex: none;
  }

  .tool-pre {
    margin: 0;
    overflow: auto;
    max-height: 18rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.5rem 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-pre.error {
    border-color: color-mix(in oklab, var(--destructive) 40%, var(--border));
    color: var(--destructive);
  }

  @keyframes tool-pulse {
    50% { opacity: 0.45; }
  }
</style>
