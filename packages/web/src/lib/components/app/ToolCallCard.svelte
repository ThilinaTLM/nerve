<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FileText from "@lucide/svelte/icons/file-text";
  import List from "@lucide/svelte/icons/list";
  import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
  import Play from "@lucide/svelte/icons/play";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type { ToolCallRecord } from "../../api";

  type Props = { toolCall: ToolCallRecord };
  let { toolCall }: Props = $props();

  const iconByTool: Record<string, typeof Wrench> = {
    read: FileText,
    bash: Terminal,
    edit: FilePen,
    write: FilePlus,
    grep: Search,
    find: Search,
    ls: List,
    ask_user: MessageCircleQuestion,
    process_start: Play,
    process_stop: Square,
    process_restart: RotateCw,
    process_list: List,
    process_logs: ScrollText,
    subagent_run: Bot,
  };

  const Icon = $derived(iconByTool[toolCall.toolName] ?? Wrench);
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

  function resultSummary(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value !== "object") return stringify(value);
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.content === "string") parts.push(record.content);
    if (Array.isArray(record.contentBlocks)) {
      for (const block of record.contentBlocks) {
        if (!block || typeof block !== "object") continue;
        const item = block as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          if (!parts.includes(item.text)) parts.push(item.text);
        } else if (item.type === "image" && typeof item.mimeType === "string") {
          parts.push(`[Image: ${item.mimeType}]`);
        }
      }
    }
    if (typeof record.stdout === "string" && record.stdout.length > 0) parts.push(`stdout:\n${record.stdout}`);
    if (typeof record.stderr === "string" && record.stderr.length > 0) parts.push(`stderr:\n${record.stderr}`);
    if (Array.isArray(record.entries)) parts.push(record.entries.map((entry) => stringify(entry)).join("\n"));
    if (Array.isArray(record.matches)) parts.push(record.matches.map((match) => stringify(match)).join("\n"));
    return parts.filter(Boolean).join("\n\n") || stringify(value);
  }

  const argsText = $derived(stringify(toolCall.args));
  const resultText = $derived(toolCall.error ?? resultSummary(toolCall.result));
  const rawResultText = $derived(stringify(toolCall.result));
  const hasArgs = $derived(argsText.trim().length > 0 && argsText.trim() !== "{}");
  const hasResult = $derived(resultText.trim().length > 0);
  const hasRawResult = $derived(
    !toolCall.error && rawResultText.trim().length > 0 && rawResultText.trim() !== resultText.trim(),
  );

  let argsOpen = $state(false);
  let resultOpen = $state(false);
  let rawResultOpen = $state(false);
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
      <span class={`tool-status status-${toolCall.status}`}>{statusLabel[toolCall.status]}</span>
      <span class="tool-risk">{toolCall.risk.replace("_", " ")}</span>
    </div>

    {#if hasArgs}
      <button type="button" class="tool-section-toggle" aria-expanded={argsOpen} onclick={() => (argsOpen = !argsOpen)}>
        <ChevronRight class="chevron" size={12} strokeWidth={2.4} />
        <span>arguments</span>
      </button>
      {#if argsOpen}
        <pre class="tool-pre">{argsText}</pre>
      {/if}
    {/if}

    {#if hasResult}
      <button type="button" class="tool-section-toggle" aria-expanded={resultOpen} onclick={() => (resultOpen = !resultOpen)}>
        <ChevronRight class="chevron" size={12} strokeWidth={2.4} />
        <span>{toolCall.error ? "error" : "result"}</span>
      </button>
      {#if resultOpen}
        <pre class="tool-pre" class:error={Boolean(toolCall.error)}>{resultText}</pre>
      {/if}
    {/if}

    {#if hasRawResult}
      <button type="button" class="tool-section-toggle raw-toggle" aria-expanded={rawResultOpen} onclick={() => (rawResultOpen = !rawResultOpen)}>
        <ChevronRight class="chevron" size={12} strokeWidth={2.4} />
        <span>raw result</span>
      </button>
      {#if rawResultOpen}
        <pre class="tool-pre">{rawResultText}</pre>
      {/if}
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
  }

  .tool-section-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    width: fit-content;
    border: 0;
    background: transparent;
    color: var(--muted-foreground);
    padding: 0;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .tool-section-toggle:hover {
    color: var(--foreground);
  }

  .tool-section-toggle :global(.chevron) {
    transition: transform 120ms ease;
  }

  .tool-section-toggle[aria-expanded="true"] :global(.chevron) {
    transform: rotate(90deg);
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
