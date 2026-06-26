<script lang="ts">
  import type { Snippet } from "svelte";
  import { StatusDot, type StatusTone } from "$lib/components/ui/status-dot";
  import type {
    MetaItem,
    PrimaryArg,
  } from "$lib/features/tools/views/tool-presentation";

  type Props = {
    /** Status suffix used for the `status-*` card class (styling hook). */
    status?: string;
    dotTone: StatusTone;
    dotPulse?: boolean;
    badge: string;
    arg?: PrimaryArg;
    error?: string;
    meta?: MetaItem[];
    detailsAction?: { label: string; onClick: () => void };
    onOpenFile?: (path: string, line?: number) => void;
    children?: Snippet;
  };
  let {
    status,
    dotTone,
    dotPulse = false,
    badge,
    arg,
    error,
    meta = [],
    detailsAction,
    onOpenFile,
    children,
  }: Props = $props();

  const showFooter = $derived(meta.length > 0 || Boolean(detailsAction));
</script>

<article class={`tool-card${status ? ` status-${status}` : ""}`}>
  <div class="tool-header">
    <StatusDot tone={dotTone} pulse={dotPulse} size="xs" class="mr-1.5 align-middle" />
    <span class="badge">{badge}</span>
    {#if arg}
      {#if arg.openPath}
        <button
          class="arg link"
          class:whitespace-pre-wrap={arg.preserveWhitespace}
          type="button"
          title={arg.text}
          onclick={() => onOpenFile?.(arg.openPath!, arg.line)}
        >{arg.text}</button>
      {:else if arg.href}
        <a
          class="arg link"
          class:whitespace-pre-wrap={arg.preserveWhitespace}
          href={arg.href}
          target="_blank"
          rel="noreferrer noopener"
          title={arg.text}
        >{arg.text}</a>
      {:else}
        <span
          class="arg"
          class:whitespace-pre-wrap={arg.preserveWhitespace}
          title={arg.text}
        >{arg.text}</span>
      {/if}
    {/if}
  </div>

  {#if error}
    <pre class="tool-error">{error}</pre>
  {/if}

  {#if children}
    <div class="tool-body">{@render children()}</div>
  {/if}

  {#if showFooter}
    <div class="tool-footer">
      {#if meta.length > 0}
        <div class="chips">
          {#each meta as item, i (i)}
            {#if item.openPath}
              <button
                class={`chip chip-action tone-${item.tone ?? "default"}`}
                class:mono={item.mono}
                type="button"
                title={item.openPath}
                onclick={() => onOpenFile?.(item.openPath!)}
              >{item.text}</button>
            {:else if item.href}
              <a
                class={`chip chip-action tone-${item.tone ?? "default"}`}
                class:mono={item.mono}
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
              >{item.text}</a>
            {:else}
              <span class={`chip tone-${item.tone ?? "default"}`} class:mono={item.mono}>{item.text}</span>
            {/if}
          {/each}
        </div>
      {/if}
      {#if detailsAction}
        <button class="more" type="button" onclick={detailsAction.onClick}>
          {detailsAction.label}
        </button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .tool-card {
    display: grid;
    gap: 0.4rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
  }

  /* Inline flow so a long arg wraps flush to the left edge (no hanging indent). */
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
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    margin-left: 0.5rem;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .arg.link {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    padding: 0;
    text-align: left;
    text-decoration: none;
  }

  .arg.link:hover {
    text-decoration: underline;
  }

  .tool-body {
    min-width: 0;
  }

  .tool-error {
    margin: 0;
    border: 1px solid color-mix(in oklab, var(--destructive) 40%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--destructive);
    padding: 0.48rem 0.58rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.6rem;
    justify-content: space-between;
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
    text-decoration: none;
  }

  .chip-action {
    cursor: pointer;
  }

  button.chip {
    font: inherit;
  }

  .chip-action:hover {
    text-decoration: underline;
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

  .more {
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    padding: 0.05rem 0.45rem;
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .more:hover {
    background: var(--sidebar);
    text-decoration: underline;
  }
</style>
