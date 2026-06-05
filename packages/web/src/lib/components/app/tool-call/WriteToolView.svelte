<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { extname } from "../../../tool-views/lang";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "write" }>;
    onOpenFile?: (path: string) => void;
  };
  let { view, onOpenFile }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.path}
  <button class="file-link" type="button" onclick={() => onOpenFile?.(view.path!)} title="Open file pane">
    Open {view.relPath ?? view.path}
  </button>
{/if}

{#if view.content !== undefined && view.content.length > 0}
  <ResultCodeBlock code={view.content} {language} maxHeight="10rem" />
{/if}

<style>
  .file-link {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    padding: 0;
    text-align: left;
  }

  .file-link:hover {
    text-decoration: underline;
  }
</style>
