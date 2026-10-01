import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts/conversations";
import { revealBoundary } from "@nervekit/ui-kit/scheduling/streaming-reveal";

const BACKSLASH = 0x5c;

/**
 * Clamp a reveal length for streamed JSON text so the prefix never ends in an
 * unfinished escape sequence (a dangling `\` or partial `\uXXXX`) or inside a
 * UTF-16 surrogate pair. Partial-JSON readers then never show stray escapes.
 */
export function jsonTextRevealBoundary(text: string, length: number): number {
  let end = revealBoundary(text, length);
  if (end <= 0 || end >= text.length) return end;

  // Find the start of the trailing backslash run.
  let runStart = end;
  while (runStart > 0 && text.charCodeAt(runStart - 1) === BACKSLASH) {
    runStart -= 1;
  }
  if ((end - runStart) % 2 === 1) return runStart;

  // A complete `\` + `u` pair needs four hex digits before it is decodable.
  const unicodeStart = text.lastIndexOf("\\u", end - 1);
  if (unicodeStart >= 0 && end - unicodeStart < 6) {
    let slashes = 0;
    for (
      let index = unicodeStart;
      index >= 0 && text.charCodeAt(index) === BACKSLASH;
      index -= 1
    ) {
      slashes += 1;
    }
    // Odd run: the `\u` is a real escape, not an escaped backslash + `u`.
    if (slashes % 2 === 1) end = unicodeStart;
  }
  return end;
}

/**
 * Presentation view of a streaming tool draft while its argument text is
 * still being revealed. Until the reveal settles the card renders the paced
 * prefix as an open draft (final args and server progress hidden), so every
 * tool-specific parser advances evenly. Settled drafts pass through unchanged.
 */
export function pacedDraftBlock(
  block: ConversationLiveToolDraftBlockSnapshot,
  argsText: string,
  revealedLength: number,
  settled: boolean,
): ConversationLiveToolDraftBlockSnapshot {
  if (settled || argsText.length === 0) return block;
  const end = jsonTextRevealBoundary(argsText, revealedLength);
  return {
    ...block,
    argsText: argsText.slice(0, end),
    args: undefined,
    progress: undefined,
    done: false,
  };
}
