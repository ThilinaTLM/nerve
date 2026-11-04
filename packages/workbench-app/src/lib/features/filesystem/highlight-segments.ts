export type HighlightSegment = { text: string; match: boolean };

/** Splits `text` into alternating plain and matched segments. Ranges are
 * [start, end) offsets; they may be unsorted, overlapping, or out of bounds. */
export function segmentsFromRanges(
  text: string,
  ranges: readonly (readonly [number, number])[],
): HighlightSegment[] {
  const sorted = ranges
    .map(
      ([start, end]) =>
        [Math.max(0, start), Math.min(text.length, end)] as const,
    )
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (end <= cursor) continue;
    const from = Math.max(start, cursor);
    if (from > cursor)
      segments.push({ text: text.slice(cursor, from), match: false });
    const last = segments[segments.length - 1];
    if (last?.match) last.text += text.slice(from, end);
    else segments.push({ text: text.slice(from, end), match: true });
    cursor = end;
  }
  if (cursor < text.length)
    segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** Converts matched character indices (fuzzy path match) into merged ranges,
 * shifted by `-offset` so a sub-slice of the path can be highlighted. */
export function rangesFromPositions(
  positions: readonly number[],
  offset = 0,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const position of [...positions].sort((a, b) => a - b)) {
    const index = position - offset;
    if (index < 0) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === index) last[1] = index + 1;
    else if (!last || index >= last[1]) ranges.push([index, index + 1]);
  }
  return ranges;
}
