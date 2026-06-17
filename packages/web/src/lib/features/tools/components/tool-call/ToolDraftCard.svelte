<script lang="ts">
  import type { LiveToolCallDraft } from "$lib/stores/workbench/state.svelte";
  import { summarizeToolDraft } from "$lib/features/tools/views/tool-draft-progress";
  import { trimTextPreview } from "$lib/utils/text-preview";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = {
    draft: LiveToolCallDraft;
  };

  let { draft }: Props = $props();

  const summary = $derived(summarizeToolDraft(draft));
  const genericPreview = $derived.by(() => {
    const text = draft.args
      ? JSON.stringify(draft.args, null, 2)
      : draft.argsText.trim() || "Waiting for arguments…";
    return trimTextPreview(text, {
      headLines: 18,
      tailLines: 6,
      maxChars: 6_000,
    }).text;
  });
</script>

<article class={`tool-draft-card draft-${summary.kind}`}>
  <div class="tool-header">
    <StatusDot tone={summary.done ? "good" : "running"} pulse={!summary.done} size="xs" />
    <span class="badge">{summary.toolName}</span>
    {#if summary.path}
      <span class="arg" title={summary.path}>{summary.path}</span>
    {:else if summary.kind === "generic"}
      <span class="arg">Preparing arguments…</span>
    {/if}
  </div>

  {#if summary.kind === "write" || summary.kind === "edit"}
    <div class="draft-progress" aria-live="polite">
      <span>{summary.statusText}</span>
      <span class="progress-spinner" aria-hidden="true"></span>
    </div>
  {:else if summary.kind === "python"}
    {#if summary.code !== undefined && summary.code.length > 0}
      <ResultCodeBlock code={summary.code} language={summary.language} trim={false} />
    {:else}
      <div class="draft-progress" aria-live="polite">
        <span>{summary.statusText}</span>
        {#if !summary.done}<span class="progress-caret" aria-hidden="true"></span>{/if}
      </div>
    {/if}
  {:else}
    <pre>{genericPreview}</pre>
  {/if}

  {#if summary.meta.length > 0}
    <div class="chips">
      {#each summary.meta as item, i (i)}
        <span class={`chip tone-${item.tone ?? "default"}`} class:mono={item.mono}>{item.text}</span>
      {/each}
    </div>
  {/if}
</article>

<style>
  .tool-draft-card {
    display: grid;
    gap: 0.4rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: color-mix(in oklab, var(--background) 94%, var(--sidebar));
  }

  .tool-header {
    min-width: 0;
    line-height: 1.5;
  }

  .tool-header :global(span[aria-hidden]) {
    margin-right: 0.4rem;
    vertical-align: middle;
  }

  .badge {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 650;
    color: var(--foreground);
  }

  .arg {
    margin-left: 0.5rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .draft-progress {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    border: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.5rem 0.58rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .progress-spinner {
    flex: none;
    width: 0.72rem;
    height: 0.72rem;
    border: 1px solid color-mix(in oklab, var(--muted-foreground) 32%, transparent);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .progress-caret {
    width: 0.38rem;
    height: 0.9rem;
    background: var(--primary);
    animation: pulse 1s steps(2, start) infinite;
  }

  pre {
    margin: 0;
    overflow: visible;
    border: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.5rem 0.58rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .chip {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--muted-foreground);
    padding: 0.05rem 0.4rem;
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: nowrap;
  }

  .chip.mono {
    font-family: var(--font-mono);
  }

  .chip.tone-success {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 35%, var(--border));
  }

  .chip.tone-warning {
    color: var(--warning);
    border-color: color-mix(in oklab, var(--warning) 35%, var(--border));
  }

  .chip.tone-error {
    color: var(--destructive);
    border-color: color-mix(in oklab, var(--destructive) 35%, var(--border));
  }

  .chip.tone-info {
    color: var(--info);
    border-color: color-mix(in oklab, var(--info) 35%, var(--border));
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes pulse {
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-spinner {
      animation: none;
    }

    .progress-caret {
      animation: none;
    }
  }
</style>
