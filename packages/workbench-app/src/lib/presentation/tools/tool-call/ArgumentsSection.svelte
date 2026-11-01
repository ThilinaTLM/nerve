<script lang="ts">
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import { serializeToolArguments } from "./tool-details-state";

type Props = { value: unknown; wrap?: boolean };
let { value, wrap = true }: Props = $props();

const content = $derived(serializeToolArguments(value));
</script>

<div class="p-3">
  <ResultCodeBlock
    bare
    code={content.text}
    language={content.language}
    {wrap}
    maxHeight="none"
    trim={false}
    highlight={content.text.length <= 256 * 1024}
  />
</div>
