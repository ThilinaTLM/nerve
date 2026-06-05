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
  let { view }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.content !== undefined && view.content.length > 0}
  <ResultCodeBlock code={view.content} {language} maxHeight="10rem" />
{/if}

