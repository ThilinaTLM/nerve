<script lang="ts">
  import type { LiveToolCallDraft } from "$lib/core/types/state-types";
  import { summarizeToolDraft } from "$lib/features/tools/views/tool-draft-progress";
  import { trimTextPreview } from "$lib/core/utils/text-preview";
  import { extname } from "$lib/features/tools/views/lang";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";
  import ToolStatusIcon from "./ToolStatusIcon.svelte";

  type Props = {
    draft: LiveToolCallDraft;
    cwd?: string;
  };

  let { draft, cwd }: Props = $props();

  const summary = $derived(summarizeToolDraft(draft, cwd));
  const draftPreviewLanguage = $derived(
    summary.previewLanguage ?? extname(summary.path),
  );
  const draftArgsPreview = $derived.by(() => {
    const text = draft.args
      ? JSON.stringify(draft.args, null, 2)
      : draft.argsText.trim();
    if (!text) return undefined;
    return trimTextPreview(text, {
      headLines: 18,
      tailLines: 6,
      maxChars: 6_000,
    }).text;
  });
  const draftArgsLanguage = $derived(draft.args || draft.argsText.trim() ? "json" : undefined);
  const genericPreview = $derived(draftArgsPreview ?? "Waiting for arguments…");
</script>

<article class={`tool-draft-card draft-${summary.kind}`}>
  <div class="tool-header">
    <ToolStatusIcon tone={summary.done ? "good" : "running"} pulse={!summary.done} size={14} class="mr-1.5 align-middle" />
    <span class="badge">{summary.toolName}</span>
    {#if summary.path}
      <span class="arg" title={summary.path}>{summary.path}</span>
    {:else if summary.kind === "python"}
      <span class="arg">inline</span>
    {:else if summary.kind === "generic"}
      <span class="arg">Preparing arguments…</span>
    {/if}
  </div>

  {#if summary.kind === "write" || summary.kind === "edit"}
    <div class="draft-progress" aria-live="polite">
      <span>{summary.statusText}</span>
      <span class="progress-spinner" aria-hidden="true"></span>
    </div>
    {#if summary.preview !== undefined && summary.preview.length > 0}
      <ResultCodeBlock
        code={summary.preview}
        language={draftPreviewLanguage}
        maxHeight="10rem"
        trim={false}
      />
    {:else if draftArgsPreview}
      <ResultCodeBlock
        code={draftArgsPreview}
        language={draftArgsLanguage}
        maxHeight="10rem"
        trim={false}
      />
    {/if}
  {:else if summary.kind === "python"}
    {#if summary.code !== undefined && summary.code.length > 0}
      <ResultCodeBlock
        code={trimTextPreview(summary.code, { headLines: 10, tailLines: 0 }).text}
        language={summary.language}
        trim={false}
      />
    {:else}
      <div class="draft-progress" aria-live="polite">
        <span>{summary.statusText}</span>
        {#if !summary.done}<span class="progress-caret" aria-hidden="true"></span>{/if}
      </div>
      {#if draftArgsPreview}
        <ResultCodeBlock
          code={draftArgsPreview}
          language={draftArgsLanguage}
          maxHeight="10rem"
          trim={false}
        />
      {/if}
    {/if}
  {:else}
    <pre>{genericPreview}</pre>
  {/if}

  {#if summary.meta.length > 0}
    <div class="chips">
      {#each summary.meta as item, i (i)}
        <span class={`chip tone-${item.tone ?? "default"}`}>{item.text}</span>
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
    padding: 0.075rem 0.45rem;
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: nowrap;
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

</style>
