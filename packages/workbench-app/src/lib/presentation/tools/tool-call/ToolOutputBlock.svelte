<script lang="ts">
import { untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { StreamingRevealLoop } from "@nervekit/ui-kit/scheduling/streaming-reveal-loop";
import {
  COLLAPSED_LINES,
  splitLogicalLines,
  tailLogicalText,
} from "../views/tool-result-view";
import { SLIDE_OVERSCAN_LINES } from "../views/tool-view-helpers";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import { getToolMotion } from "./tool-motion-context";

type Props = {
  text: string;
  language?: string;
  direction?: "head" | "tail";
  collapsedLines?: number;
  expanded?: boolean;
  terminal?: boolean;
  /** Output is still arriving: animate the collapsed box as it grows. */
  live?: boolean;
  /** Fade, slide and pace live output; defaults to the card's tool motion. */
  streamMotion?: boolean;
  /** Output arrived all at once in this session; defaults to the card's. */
  enter?: boolean;
  /** Clip collapsed output instead of letting wrapped rows scroll. */
  overflow?: "auto" | "hidden";
  onActivate?: () => void;
  activateLabel?: string;
};
let {
  text,
  language,
  direction = "head",
  collapsedLines = COLLAPSED_LINES,
  expanded = false,
  terminal = false,
  live = false,
  streamMotion: streamMotionOverride,
  enter: enterOverride,
  overflow = "auto",
  onActivate,
  activateLabel,
}: Props = $props();

const toolMotion = getToolMotion();
const streamMotion = $derived(streamMotionOverride ?? toolMotion.streamMotion);
const enter = $derived(!live && (enterOverride ?? toolMotion.enter));

// Live process output is real time, so it is never paced per character.
// Bursts drip out as whole lines over ~120 ms; backlog that could not be seen
// in the collapsed window is skipped.
const LIVE_OUTPUT_LAG_S = 0.12;
const pacing = $derived(
  live &&
    streamMotion &&
    !expanded &&
    direction === "tail" &&
    !prefersReducedMotion.current,
);
let revealedLength = $state(untrack(() => text.length));
const revealLoop = new StreamingRevealLoop(
  untrack(() => text.length),
  {
    onReveal: (length) => (revealedLength = length),
    pacer: { targetLagS: LIVE_OUTPUT_LAG_S },
  },
);

/** Offset where the last `count` logical lines of `source` begin. */
function lastLinesStart(source: string, count: number): number {
  let remaining = count;
  for (let index = source.length - 2; index >= 0; index -= 1) {
    if (source.charCodeAt(index) !== 10) continue;
    remaining -= 1;
    if (remaining === 0) return index + 1;
  }
  return 0;
}

$effect(() => {
  const source = text;
  if (!pacing) {
    revealLoop.snap(source.length);
    revealedLength = source.length;
    return;
  }
  untrack(() => {
    const windowStart = lastLinesStart(
      source,
      collapsedLines + SLIDE_OVERSCAN_LINES,
    );
    if (revealLoop.shownLength < windowStart) revealLoop.snap(windowStart);
    revealLoop.setTarget(source.length);
  });
});
$effect(() => () => revealLoop.destroy());

const shownText = $derived.by(() => {
  if (!pacing) return text;
  const shown = Math.min(revealedLength, text.length);
  if (shown >= text.length) return text;
  // Whole lines only; the partial last line shows once the reveal catches up.
  return text.slice(0, text.lastIndexOf("\n", shown - 1) + 1);
});

const visible = $derived.by(() => {
  if (expanded) return shownText;
  if (direction === "tail") {
    return tailLogicalText(
      shownText,
      collapsedLines + (live ? SLIDE_OVERSCAN_LINES : 0),
    );
  }
  const lines = splitLogicalLines(shownText);
  if (lines.length <= collapsedLines) return shownText;
  return lines.slice(0, collapsedLines).join("\n");
});
</script>

<ResultCodeBlock
  code={visible}
  {language}
  trim={false}
  {terminal}
  live={live && !expanded}
  streamMotion={streamMotion && !expanded}
  {enter}
  overflow={expanded ? "auto" : overflow}
  fixedRows={expanded ? undefined : collapsedLines}
  tail={!expanded && direction === "tail"}
  {onActivate}
  {activateLabel}
/>
