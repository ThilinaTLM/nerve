/**
 * Optimistic tokenizer for the unresolved tail of streaming Markdown (the
 * text after the last parsed paragraph boundary). It hides syntax as soon as
 * it appears so the tail already looks like the final render: `**bold` is
 * bold before it closes, `[text](url…` shows only `text`, and `- ` lines are
 * list items. Every text token keeps its absolute source offsets so fresh
 * ranges can fade. Anything it does not model falls back to a plain block,
 * which renders exactly like the previous escaped-text tail.
 */

export const MARK_STRONG = 1;
export const MARK_EM = 2;
export const MARK_CODE = 4;
export const MARK_DEL = 8;
export const MARK_LINK = 16;

/** Tails longer than this render as plain text. */
export const MAX_OPTIMISTIC_TAIL_CHARS = 4000;

export type InlineToken =
  | { kind: "text"; start: number; end: number; marks: number }
  | { kind: "break" };

export type StreamingBlock =
  | { kind: "paragraph"; inline: InlineToken[] }
  | { kind: "heading"; level: number; inline: InlineToken[] }
  | {
      kind: "list";
      ordered: boolean;
      /** First number of an ordered list. */
      start: number;
      items: InlineToken[][];
    }
  /** Unmodelled syntax: escaped source text from `start` to `end`. */
  | { kind: "plain"; start: number; end: number };

type Line = { start: number; end: number };

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const PENDING_HEADING = /^ {0,3}#{1,6}$/;
const LIST_ITEM = /^( {0,3})([-*+]|(\d{1,9})[.)])[ \t]+/;
const PENDING_LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])$/;
const INDENTED_LIST_ITEM = /^ {4,}(?:[-*+]|\d{1,9}[.)])[ \t]/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const SETEXT_OR_RULE = /^ {0,3}(?:=+|-{2,}|\*{3,}|_{3,})[ \t]*$/;
const UNMODELLED_BLOCK = /^ {0,3}(?:>|\||<|\[[^\]]*\]:)/;
const TASK_ITEM = /^\[[ xX]\](?:[ \t]|$)/;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

function splitLines(source: string, from: number): Line[] {
  const lines: Line[] = [];
  let offset = from;
  while (offset <= source.length) {
    const newline = source.indexOf("\n", offset);
    const end = newline === -1 ? source.length : newline;
    lines.push({ start: offset, end });
    if (newline === -1) break;
    offset = newline + 1;
  }
  // A trailing newline leaves an empty last line; it carries no content.
  if (lines.length > 1 && lines.at(-1)!.start === source.length) lines.pop();
  return lines;
}

function lineText(source: string, line: Line): string {
  return source.slice(line.start, line.end);
}

function skipIndent(source: string, start: number, end: number): number {
  let offset = start;
  while (offset < end && (source[offset] === " " || source[offset] === "\t")) {
    offset += 1;
  }
  return offset;
}

/** Tokenize the streaming tail `source.slice(from)` into blocks. */
export function tokenizeStreamingTail(
  source: string,
  from = 0,
): StreamingBlock[] {
  if (from >= source.length) return [];
  if (source.length - from > MAX_OPTIMISTIC_TAIL_CHARS) {
    return [{ kind: "plain", start: from, end: source.length }];
  }

  const blocks: StreamingBlock[] = [];
  // Content ranges per block, tokenized inline once grouping is known.
  let paragraph: Line[] | undefined;
  let list:
    | { ordered: boolean; start: number; items: Line[][]; marker: string }
    | undefined;

  const flush = () => {
    if (paragraph) {
      blocks.push({
        kind: "paragraph",
        inline: tokenizeInline(source, paragraph),
      });
    }
    if (list) {
      blocks.push({
        kind: "list",
        ordered: list.ordered,
        start: list.start,
        items: list.items.map((item) => tokenizeInline(source, item)),
      });
    }
    paragraph = undefined;
    list = undefined;
  };

  const lines = splitLines(source, from);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const text = lineText(source, line);
    const isLast = index === lines.length - 1;

    if (text.trim() === "") continue;

    if (
      FENCE.test(text) ||
      UNMODELLED_BLOCK.test(text) ||
      INDENTED_LIST_ITEM.test(text) ||
      (SETEXT_OR_RULE.test(text) && (paragraph || list || !isLast))
    ) {
      flush();
      blocks.push({ kind: "plain", start: line.start, end: source.length });
      return blocks;
    }

    // A marker without its trailing space yet may still become a heading or
    // list item: hold it back instead of flashing it as text.
    if (
      isLast &&
      (PENDING_HEADING.test(text) || PENDING_LIST_ITEM.test(text))
    ) {
      continue;
    }
    // A lone rule-like run may still turn into a rule or setext underline.
    if (isLast && SETEXT_OR_RULE.test(text)) continue;

    const heading = HEADING.exec(text);
    if (heading) {
      flush();
      const contentStart = line.start + heading[0].length;
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        inline: tokenizeInline(source, [
          {
            start: contentStart,
            end: trimClosingHashes(source, contentStart, line.end),
          },
        ]),
      });
      continue;
    }

    const item = LIST_ITEM.exec(text);
    if (item) {
      const contentStart = line.start + item[0].length;
      if (TASK_ITEM.test(source.slice(contentStart, line.end))) {
        flush();
        blocks.push({ kind: "plain", start: line.start, end: source.length });
        return blocks;
      }
      const marker = item[3] === undefined ? item[2]! : item[2]!.slice(-1);
      const ordered = item[3] !== undefined;
      if (paragraph && ordered && Number(item[3]) !== 1) {
        // CommonMark: only an ordered list starting at 1 interrupts a
        // paragraph; otherwise this is paragraph text.
        paragraph.push(line);
        continue;
      }
      if (!list || list.marker !== marker) {
        flush();
        list = {
          ordered,
          start: ordered ? Number(item[3]) : 1,
          items: [],
          marker,
        };
      }
      list.items.push([{ start: contentStart, end: line.end }]);
      continue;
    }

    if (list) {
      // Lazy continuation line of the last list item.
      list.items.at(-1)!.push(line);
      continue;
    }
    paragraph ??= [];
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function trimClosingHashes(source: string, start: number, end: number): number {
  let cursor = end;
  while (cursor > start && /[ \t]/.test(source[cursor - 1]!)) cursor -= 1;
  let hashes = cursor;
  while (hashes > start && source[hashes - 1] === "#") hashes -= 1;
  if (
    hashes < cursor &&
    (hashes === start || /[ \t]/.test(source[hashes - 1]!))
  ) {
    cursor = hashes;
    while (cursor > start && /[ \t]/.test(source[cursor - 1]!)) cursor -= 1;
  }
  return cursor;
}

type Opener = { char: string; mark: number };

/**
 * Tokenize inline content spread over line ranges. Lines are joined with
 * break tokens; their leading indentation is dropped, as Markdown does.
 */
export function tokenizeInline(source: string, lines: Line[]): InlineToken[] {
  const tokens: InlineToken[] = [];
  const contentEnd = lines.at(-1)?.end ?? 0;
  let marks = 0;
  const openers: Opener[] = [];

  const emit = (start: number, end: number) => {
    if (end <= start) return;
    const previous = tokens.at(-1);
    if (
      previous?.kind === "text" &&
      previous.end === start &&
      previous.marks === marks
    ) {
      previous.end = end;
      return;
    }
    tokens.push({ kind: "text", start, end, marks });
  };

  const toggle = (char: string, mark: number): boolean => {
    const index = openers.findLastIndex(
      (opener) => opener.char === char && opener.mark === mark,
    );
    if (index === -1) return false;
    openers.splice(index, 1);
    marks &= ~mark;
    return true;
  };

  const open = (char: string, mark: number) => {
    openers.push({ char, mark });
    marks |= mark;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (lineIndex > 0) {
      if ((marks & MARK_CODE) !== 0) emit(line.start - 1, line.start);
      else tokens.push({ kind: "break" });
    }
    let offset = skipIndent(source, line.start, line.end);
    let runStart = offset;
    const end = line.end;

    const flushRun = (until: number) => {
      emit(runStart, until);
    };

    while (offset < end) {
      const char = source[offset]!;

      if ((marks & MARK_CODE) !== 0) {
        if (char === "`") {
          const run = backtickRun(source, offset, end);
          const opener = openers.findLast((item) => item.mark === MARK_CODE);
          if (opener && opener.char.length === run) {
            flushRun(offset);
            toggle(opener.char, MARK_CODE);
            offset += run;
            runStart = offset;
            continue;
          }
          offset += run;
          continue;
        }
        offset += 1;
        continue;
      }

      if (
        char === "\\" &&
        offset + 1 < end &&
        ASCII_PUNCTUATION.test(source[offset + 1]!)
      ) {
        flushRun(offset);
        runStart = offset + 1;
        offset += 2;
        continue;
      }
      if (char === "\\" && offset + 1 === end && end === contentEnd) {
        // A trailing backslash may still escape the next character.
        flushRun(offset);
        runStart = end;
        offset = end;
        continue;
      }

      if (char === "`") {
        const run = backtickRun(source, offset, end);
        flushRun(offset);
        offset += run;
        runStart = offset;
        if (offset === contentEnd) continue; // could still grow into a fence
        open("`".repeat(run), MARK_CODE);
        continue;
      }

      if (char === "*" || char === "_") {
        const run = delimiterRun(source, offset, end, char);
        const before = offset > line.start ? source[offset - 1]! : " ";
        const after = offset + run < end ? source[offset + run]! : undefined;
        if (after === undefined && offset + run === contentEnd) {
          // Still streaming: the run may open or close; hide it for now.
          flushRun(offset);
          offset += run;
          runStart = offset;
          continue;
        }
        // Flush text before the run under the marks that applied to it.
        flushRun(offset);
        runStart = offset;
        offset += run;
        if (applyEmphasis(char, run, before, after ?? " ")) runStart = offset;
        continue;
      }

      if (char === "~" && source[offset + 1] === "~") {
        const before = offset > line.start ? source[offset - 1]! : " ";
        const after = offset + 2 < end ? source[offset + 2]! : undefined;
        if (after === undefined && offset + 2 === contentEnd) {
          flushRun(offset);
          offset += 2;
          runStart = offset;
          continue;
        }
        if ((marks & MARK_DEL) !== 0 && !/\s/.test(before)) {
          flushRun(offset);
          toggle("~~", MARK_DEL);
          offset += 2;
          runStart = offset;
          continue;
        }
        if (after && !/\s/.test(after) && !WORD.test(before)) {
          flushRun(offset);
          open("~~", MARK_DEL);
          offset += 2;
          runStart = offset;
          continue;
        }
        offset += 2;
        continue;
      }

      if (char === "[") {
        const link = scanLink(source, offset, end, contentEnd);
        if (link) {
          flushRun(offset);
          // The label is single-line inline content of its own; outer marks
          // (and the link mark once `](` is seen) apply on top.
          const outer = marks | (link.isLink ? MARK_LINK : 0);
          for (const token of tokenizeInline(source, [
            { start: offset + 1, end: link.labelEnd },
          ])) {
            if (token.kind !== "text") continue;
            const previous = tokens.at(-1);
            const tokenMarks = token.marks | outer;
            if (
              previous?.kind === "text" &&
              previous.end === token.start &&
              previous.marks === tokenMarks
            ) {
              previous.end = token.end;
            } else {
              tokens.push({ ...token, marks: tokenMarks });
            }
          }
          offset = link.after;
          runStart = offset;
          continue;
        }
      }

      offset += 1;
    }
    flushRun(end);
  }
  return tokens;

  function applyEmphasis(
    char: string,
    run: number,
    before: string,
    after: string,
  ): boolean {
    const canOpen =
      !/\s/.test(after) &&
      // Intraword delimiters stay literal (`file_name`, `2*3`).
      !WORD.test(before);
    const canClose = !/\s/.test(before);
    let remaining = run;
    let changed = false;
    if (canClose) {
      while (
        remaining >= 2 &&
        (marks & MARK_STRONG) !== 0 &&
        toggle(char, MARK_STRONG)
      ) {
        remaining -= 2;
        changed = true;
      }
      if (remaining >= 1 && (marks & MARK_EM) !== 0 && toggle(char, MARK_EM)) {
        remaining -= 1;
        changed = true;
      }
      if (
        remaining >= 2 &&
        (marks & MARK_STRONG) !== 0 &&
        toggle(char, MARK_STRONG)
      ) {
        remaining -= 2;
        changed = true;
      }
      if (changed && remaining === 0) return true;
    }
    if (canOpen && remaining > 0) {
      if (remaining >= 3) {
        open(char, MARK_STRONG);
        open(char, MARK_EM);
      } else if (remaining === 2) {
        open(char, MARK_STRONG);
      } else {
        open(char, MARK_EM);
      }
      return true;
    }
    return changed && remaining === 0;
  }
}

function backtickRun(source: string, offset: number, end: number): number {
  let cursor = offset;
  while (cursor < end && source[cursor] === "`") cursor += 1;
  return cursor - offset;
}

function delimiterRun(
  source: string,
  offset: number,
  end: number,
  char: string,
): number {
  let cursor = offset;
  while (cursor < end && source[cursor] === char) cursor += 1;
  return cursor - offset;
}

/**
 * Scan `[label](destination)` starting at `offset`. Returns the label range
 * and where scanning continues. Optimistic while streaming: an unclosed label
 * or destination at the end of the content hides the syntax it has so far.
 */
function scanLink(
  source: string,
  offset: number,
  end: number,
  contentEnd: number,
): { labelEnd: number; after: number; isLink: boolean } | undefined {
  const close = source.indexOf("]", offset + 1);
  if (close === -1 || close >= end) {
    // Label still streaming at the very end: show it without the bracket.
    if (end === contentEnd && source.indexOf("[", offset + 1) === -1) {
      return { labelEnd: end, after: end, isLink: false };
    }
    return undefined;
  }
  if (source.lastIndexOf("[", close - 1) !== offset) return undefined;
  if (close + 1 === end && end === contentEnd) {
    return { labelEnd: close, after: end, isLink: false };
  }
  if (source[close + 1] !== "(") return undefined;
  const destinationEnd = source.indexOf(")", close + 2);
  if (destinationEnd === -1 || destinationEnd >= end) {
    if (end !== contentEnd) return undefined;
    return { labelEnd: close, after: end, isLink: true };
  }
  return { labelEnd: close, after: destinationEnd + 1, isLink: true };
}
