import type { ProjectableBlock } from "./types.js";

export type ProjectionMeasure = {
  bytes: number;
  lines: number;
};

export function textLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

export function measureText(text: string): ProjectionMeasure {
  return { bytes: Buffer.byteLength(text, "utf8"), lines: textLines(text) };
}

export function measureBlocks(
  blocks: readonly ProjectableBlock[],
): ProjectionMeasure {
  let bytes = 0;
  let lines = 0;
  for (const block of blocks) {
    if (block.type !== "text") continue;
    const measured = measureText(block.text);
    bytes += measured.bytes;
    lines += measured.lines;
  }
  return { bytes, lines };
}

export function blocksFit(
  blocks: readonly ProjectableBlock[],
  budget: { maxBytes: number; maxLines: number },
): boolean {
  const measured = measureBlocks(blocks);
  return measured.bytes <= budget.maxBytes && measured.lines <= budget.maxLines;
}

/** Select a UTF-8-safe textual head. */
export function textHead(
  text: string,
  maxBytes: number,
  maxLines: number,
): string {
  if (maxBytes <= 0 || maxLines <= 0 || text.length === 0) return "";
  const lines = text.split("\n");
  let result = "";
  let usedLines = 0;
  for (const line of lines) {
    if (usedLines >= maxLines) break;
    const prefix = result.length > 0 ? "\n" : "";
    const candidate = `${prefix}${line}`;
    const remaining = maxBytes - Buffer.byteLength(result, "utf8");
    if (Buffer.byteLength(candidate, "utf8") <= remaining) {
      result += candidate;
      usedLines += 1;
      continue;
    }
    let partial = prefix;
    for (const character of line) {
      const next = partial + character;
      if (Buffer.byteLength(next, "utf8") > remaining) break;
      partial = next;
    }
    result += partial;
    break;
  }
  return result;
}

export function textTail(
  text: string,
  maxBytes: number,
  maxLines: number,
): string {
  const lines = text.split("\n").slice(-maxLines);
  let result = lines.join("\n");
  while (Buffer.byteLength(result, "utf8") > maxBytes && result.length > 0) {
    const codepoints = Array.from(result);
    codepoints.shift();
    result = codepoints.join("");
  }
  return result;
}
