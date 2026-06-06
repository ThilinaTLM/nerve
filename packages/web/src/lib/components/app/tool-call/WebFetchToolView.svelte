<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "web_fetch" }>;
  };
  let { view }: Props = $props();

  function formatSize(bytes: number | undefined): string | undefined {
    if (bytes === undefined) return undefined;
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }
</script>

<div class="meta">
  {#if view.status}<span class="status">{view.status}</span>{/if}
  {#if view.contentType}<span>{view.contentType}</span>{/if}
  {#if formatSize(view.size)}<span>{formatSize(view.size)}</span>{/if}
  {#if view.converted}<span class="converted">markdown</span>{/if}
</div>

{#if view.savedTo}
  <p class="note">Saved to <span class="path">{view.savedTo}</span></p>
{/if}

{#if view.preview}
  <pre class="preview">{view.preview}</pre>
{/if}

<style>
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .meta span {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    padding: 0.12rem 0.35rem;
  }

  .status {
    color: var(--success);
    font-weight: 700;
  }

  .converted {
    color: var(--info);
    font-weight: 650;
  }

  .note {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .path {
    font-family: var(--font-mono);
  }

  .preview {
    margin: 0;
    overflow: visible;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.48rem 0.58rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
