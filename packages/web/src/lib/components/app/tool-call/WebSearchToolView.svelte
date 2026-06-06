<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "web_search" }>;
  };
  let { view }: Props = $props();
</script>

{#if view.answer}
  <div class="answer">{view.answer}</div>
{/if}

{#if view.results.length > 0}
  <div class="results">
    {#each view.results as result (result.url)}
      <a class="result" href={result.url} target="_blank" rel="noreferrer">
        <span class="result-title">{result.title}</span>
        <span class="result-url">{result.url}</span>
      </a>
    {/each}
  </div>
{:else if !view.answer}
  <p class="note">No results.</p>
{/if}

<style>
  .answer {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.5rem 0.6rem;
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .results {
    display: grid;
    gap: 0.45rem;
  }

  .result {
    display: grid;
    gap: 0.15rem;
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    padding: 0.48rem 0.58rem;
  }

  .result:hover .result-title {
    text-decoration: underline;
  }

  .result-title {
    color: var(--foreground);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.35;
  }

  .result-url {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .note {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
</style>
