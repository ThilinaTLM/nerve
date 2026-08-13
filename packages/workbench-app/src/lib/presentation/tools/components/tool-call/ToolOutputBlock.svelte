<script lang="ts">
import {
  COLLAPSED_LINES,
  splitLogicalLines,
  tailLogicalText,
} from "../../views/tool-result-view";
import ResultCodeBlock from "./ResultCodeBlock.svelte";

type Props = {
  text: string;
  language?: string;
  direction?: "head" | "tail";
  collapsedLines?: number;
  expanded?: boolean;
  terminal?: boolean;
};
let {
  text,
  language,
  direction = "head",
  collapsedLines = COLLAPSED_LINES,
  expanded = false,
  terminal = false,
}: Props = $props();

const visible = $derived.by(() => {
  if (expanded) return text;
  if (direction === "tail") return tailLogicalText(text, collapsedLines);
  const lines = splitLogicalLines(text);
  if (lines.length <= collapsedLines) return text;
  return lines.slice(0, collapsedLines).join("\n");
});
</script>

<ResultCodeBlock
  code={visible}
  {language}
  trim={false}
  {terminal}
  fixedRows={expanded ? undefined : collapsedLines}
  tail={!expanded && direction === "tail"}
/>
