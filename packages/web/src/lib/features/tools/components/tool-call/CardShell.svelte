<script lang="ts">
  import type { Snippet } from "svelte";
  import type { StatusTone } from "$lib/components/ui/status-dot";
  import type {
    MetaItem,
    PrimaryArg,
  } from "$lib/features/tools/views/tool-presentation";
  import ToolStatusIcon from "./ToolStatusIcon.svelte";
  import ToolFooter from "./ToolFooter.svelte";

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
    /**
     * Render the generic footer (meta chips + show-more). Interactive HIL tools
     * suppress this and render their own footer (chips + action buttons) inside
     * the body so chips and buttons share one line.
     */
    footer?: boolean;
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
    footer = true,
    onOpenFile,
    children,
  }: Props = $props();
</script>

<article class={`tool-card${status ? ` status-${status}` : ""}`}>
  <div class="tool-header">
    <ToolStatusIcon tone={dotTone} pulse={dotPulse} size={14} class="mr-1.5 align-middle" />
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

  {#if footer}
    <ToolFooter {meta} {detailsAction} {onOpenFile} />
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
</style>
