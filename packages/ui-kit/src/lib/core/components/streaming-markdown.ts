export type StreamingMarkdownParts = {
  prefix: string;
  tail: string;
};

/**
 * Select a conservative streaming boundary. Only blank lines outside fenced
 * code advance the parsed prefix; the unresolved suffix remains escaped text.
 */
export function splitStreamingMarkdown(source: string): StreamingMarkdownParts {
  let boundary = 0;
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | undefined;

  while (offset < source.length) {
    const newline = source.indexOf("\n", offset);
    const hasLineBreak = newline !== -1;
    const lineEnd = hasLineBreak ? newline : source.length;
    const nextOffset = hasLineBreak ? lineEnd + 1 : lineEnd;
    const line = source.slice(offset, lineEnd);
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      const markerType = marker[0] as "`" | "~";
      if (!fence) {
        fence = { marker: markerType, length: marker.length };
      } else if (
        fence.marker === markerType &&
        marker.length >= fence.length &&
        line.slice(line.indexOf(marker) + marker.length).trim() === ""
      ) {
        fence = undefined;
      }
    }

    offset = nextOffset;
    if (!fence && hasLineBreak && line.trim() === "") boundary = offset;
  }

  return {
    prefix: source.slice(0, boundary),
    tail: source.slice(boundary),
  };
}

export function appendedNewline(previous: string, next: string): boolean {
  return (
    next.length > previous.length && next.slice(previous.length).includes("\n")
  );
}
