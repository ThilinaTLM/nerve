<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { extname } from "../../../tool-views/lang";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import Disclosure from "./Disclosure.svelte";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "write" }> };
  let { view }: Props = $props();

  const language = $derived(extname(view.relPath));
</script>

{#if view.content !== undefined && view.content.length > 0}
  <Disclosure label="content">
    <ResultCodeBlock code={view.content} {language} />
  </Disclosure>
{/if}
