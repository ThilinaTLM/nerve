import type { ExactContinuation } from "@nervekit/contracts/tools";
import { record, array, number } from "./candidate-values.js";

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

export function continuationText(continuation: ExactContinuation): string {
  switch (continuation.kind) {
    case "line":
      return `Continue with offset=${continuation.nextOffset}.`;
    case "byte":
      return `Continue with byteOffset=${continuation.nextByteOffset}.`;
    case "cursor":
      return `Continue with ${continuation.cursorName}=${String(continuation.value)}.`;
    case "page_token":
      return `Continue with ${continuation.parameter}=${continuation.value}.`;
  }
}

export function relatedCollectionContinuations(
  details: Record<string, unknown>,
): ExactContinuation[] {
  const pages = array(details.relatedCollections) ?? [];
  return pages.flatMap((value) => {
    const page = record(value);
    const continuation = record(page.continuation);
    if (
      typeof continuation.parameter !== "string" ||
      (typeof continuation.value !== "string" &&
        typeof continuation.value !== "number")
    )
      return [];
    return [
      {
        kind: "cursor" as const,
        cursorName: continuation.parameter,
        value: continuation.value,
        direction:
          continuation.direction === "before"
            ? ("before" as const)
            : ("after" as const),
      },
    ];
  });
}
