<script lang="ts">
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = { diff: string; maxHeight?: string };
  let { diff, maxHeight = "22rem" }: Props = $props();
</script>

<ResultCodeBlock code={diff} language="diff" {maxHeight} />
