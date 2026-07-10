export type TrimmedTextPreview = {
  text: string;
  omittedLines: number;
  omittedChars: number;
  trimmed: boolean;
};

type TrimTextPreviewOptions = {
  headLines?: number;
  tailLines?: number;
  maxChars?: number;
  marker?: (omittedLines: number, omittedChars: number) => string;
};

const DEFAULT_HEAD_LINES = 24;
const DEFAULT_TAIL_LINES = 8;
const DEFAULT_MAX_CHARS = 12_000;

function defaultMarker(omittedLines: number, omittedChars: number): string {
  if (omittedLines > 0 && omittedChars > 0) {
    return `… ${omittedLines.toLocaleString()} lines / ${omittedChars.toLocaleString()} chars omitted …`;
  }
  if (omittedLines > 0)
    return `… ${omittedLines.toLocaleString()} lines omitted …`;
  return `… ${omittedChars.toLocaleString()} chars omitted …`;
}

export function trimTextPreview(
  input: string,
  options: TrimTextPreviewOptions = {},
): TrimmedTextPreview {
  const headLines = Math.max(0, options.headLines ?? DEFAULT_HEAD_LINES);
  const tailLines = Math.max(0, options.tailLines ?? DEFAULT_TAIL_LINES);
  const maxChars = Math.max(0, options.maxChars ?? DEFAULT_MAX_CHARS);
  const marker = options.marker ?? defaultMarker;

  let text = input;
  let omittedLines = 0;
  let omittedChars = 0;

  const lines = input.split("\n");
  const lineBudget = headLines + tailLines;
  if (lineBudget > 0 && lines.length > lineBudget) {
    omittedLines = lines.length - lineBudget;
    const omittedSegment = lines
      .slice(headLines, lines.length - tailLines)
      .join("\n");
    omittedChars = omittedSegment.length;
    const head = lines.slice(0, headLines);
    const tail = tailLines > 0 ? lines.slice(-tailLines) : [];
    text = [...head, marker(omittedLines, omittedChars), ...tail].join("\n");
  }

  if (maxChars > 0 && text.length > maxChars) {
    const extraChars = text.length - maxChars;
    omittedChars += extraChars;
    const markerText = marker(omittedLines, omittedChars);
    const visibleBudget = Math.max(0, maxChars - markerText.length - 2);
    const headChars = Math.ceil(visibleBudget * 0.72);
    const tailChars = Math.max(0, visibleBudget - headChars);
    text = [
      text.slice(0, headChars),
      markerText,
      tailChars > 0 ? text.slice(-tailChars) : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return {
    text,
    omittedLines,
    omittedChars,
    trimmed: text !== input,
  };
}
