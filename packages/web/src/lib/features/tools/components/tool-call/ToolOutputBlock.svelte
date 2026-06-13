<script lang="ts">
  import { COLLAPSED_LINES, tail } from "$lib/features/tools/views/tool-result-view";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = {
    text: string;
    language?: string;
    direction?: "head" | "tail";
    collapsedLines?: number;
    expanded?: boolean;
  };
  let {
    text,
    language,
    direction = "head",
    collapsedLines = COLLAPSED_LINES,
    expanded = false,
  }: Props = $props();

  const visible = $derived.by(() => {
    if (expanded) return text;
    const lines = text.split("\n");
    if (lines.length <= collapsedLines) return text;
    return direction === "tail"
      ? tail(lines, collapsedLines).join("\n")
      : lines.slice(0, collapsedLines).join("\n");
  });
</script>

<ResultCodeBlock code={visible} {language} trim={false} />
