<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import DiffBlock from "./DiffBlock.svelte";
  import Disclosure from "./Disclosure.svelte";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "edit" }> };
  let { toolCall, view }: Props = $props();

  const editsJson = $derived(JSON.stringify((toolCall.args as { edits?: unknown })?.edits ?? [], null, 2));
</script>

{#if view.diff}
  <DiffBlock diff={view.diff} />
{/if}
<Disclosure label="edits">
  <ResultCodeBlock code={editsJson} language="json" />
</Disclosure>
