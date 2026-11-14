import type { ExactContinuation } from "@nervekit/contracts/tools";
import { number } from "./candidate-values.js";

export function continuations(
  value: Record<string, unknown>,
): ExactContinuation[] {
  const output: ExactContinuation[] = [];
  const next = value.nextPageToken ?? value.next_page_token;
  if (typeof next === "string")
    output.push({
      kind: "page_token",
      parameter: "nextPageToken",
      value: next,
    });
  const cursor = value.nextCursor ?? value.cursor;
  if (typeof cursor === "string" || typeof cursor === "number")
    output.push({
      kind: "cursor",
      cursorName: "cursor",
      value: cursor,
      direction: "after",
    });
  const older = number(value.olderBeforeSeq) ?? number(value.beforeSeq);
  if (older !== undefined)
    output.push({
      kind: "cursor",
      cursorName: "cursor",
      value: older,
      direction: "before",
    });
  const future = number(value.futureSinceSeq) ?? number(value.nextCursor);
  if (future !== undefined)
    output.push({
      kind: "cursor",
      cursorName: "sinceSeq",
      value: future,
      direction: "after",
    });
  return output;
}

/** One copyable hint: `Next: {"offset":95}`; a backward cursor reads `Earlier:`. */
export function continuationText(continuation: ExactContinuation): string {
  const hint = (label: string, name: string, value: string | number) =>
    `${label}: ${JSON.stringify({ [name]: value })}`;
  switch (continuation.kind) {
    case "line":
      return hint("Next", "offset", continuation.nextOffset);
    case "byte":
      return hint("Next", "byteOffset", continuation.nextByteOffset);
    case "cursor":
      return hint(
        continuation.direction === "before" ? "Earlier" : "Next",
        continuation.cursorName,
        continuation.value,
      );
    case "page_token":
      return hint("Next", continuation.parameter, continuation.value);
  }
}
