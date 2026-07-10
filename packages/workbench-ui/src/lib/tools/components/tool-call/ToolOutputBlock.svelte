<script lang="ts">
import { COLLAPSED_LINES, tail } from "../../views/tool-result-view";
import ResultCodeBlock from "./ResultCodeBlock.svelte";

type Props = {
  text: string;
  language?: string;
  direction?: "head" | "tail";
  collapsedLines?: number;
  expanded?: boolean;
  outputLimits?: {
    live?: {
      capped?: boolean;
      omittedChars?: number;
      displayedLines?: number;
      displayedChars?: number;
    };
  };
  terminal?: boolean;
};
let {
  text,
  language,
  direction = "head",
  collapsedLines = COLLAPSED_LINES,
  expanded = false,
  outputLimits,
  terminal = false,
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

{#if outputLimits?.live?.capped}
  <p class="m-0 text-xs text-muted-foreground">
    Showing latest
    {outputLimits.live.displayedLines ?? 0} lines / {outputLimits.live
      .displayedChars ?? 0} chars;
    {outputLimits.live.omittedChars ?? 0} earlier chars omitted from live preview.
  </p>
{/if}

<ResultCodeBlock code={visible} {language} trim={false} {terminal} />
