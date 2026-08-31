import {
  LIVE_TOOL_OUTPUT_MAX_CHARS,
  LIVE_TOOL_OUTPUT_MAX_CHUNKS,
  type ConversationLiveToolOutputSnapshot,
} from "@nervekit/contracts/conversations";

export function capToolOutput(
  output: ConversationLiveToolOutputSnapshot,
  totals: { totalChars?: number } = {},
): ConversationLiveToolOutputSnapshot {
  const totalChars = totals.totalChars ?? output.text.length;
  let text = output.text;
  if (text.length > LIVE_TOOL_OUTPUT_MAX_CHARS) {
    text = text.slice(text.length - LIVE_TOOL_OUTPUT_MAX_CHARS);
  }
  const chunks =
    output.chunks.length > LIVE_TOOL_OUTPUT_MAX_CHUNKS
      ? output.chunks.slice(output.chunks.length - LIVE_TOOL_OUTPUT_MAX_CHUNKS)
      : output.chunks;
  const capped =
    totalChars > text.length ||
    output.chunks.length > LIVE_TOOL_OUTPUT_MAX_CHUNKS;
  return {
    ...output,
    text,
    chunks,
    outputLimits: {
      capped,
      direction: "tail",
      maxChars: LIVE_TOOL_OUTPUT_MAX_CHARS,
      maxChunks: LIVE_TOOL_OUTPUT_MAX_CHUNKS,
      totalChars,
      displayedChars: text.length,
      omittedChars: Math.max(0, totalChars - text.length),
      displayedLines: countLines(text),
      totalLines: capped ? undefined : countLines(text),
      omittedLines: undefined,
    },
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}
