export type InlineCommandPrompt = {
  command: string;
  /** Zero-based offset of the leading ! marker in the original prompt. */
  bangOffset: number;
};

export type ExecutableCommandBlock = {
  /** Zero-based start offset of the full fenced block. */
  start: number;
  /** Zero-based end offset (exclusive) of the full fenced block. */
  end: number;
  /** Zero-based start offset of command content inside the fenced block. */
  commandStart: number;
  /** Zero-based end offset (exclusive) of command content inside the fenced block. */
  commandEnd: number;
  fenceChar: "`" | "~";
  fenceLength: number;
  command: string;
};

export type ExecutableCommandBlockReplacement = {
  block: Pick<ExecutableCommandBlock, "start" | "end">;
  text: string;
};

export function parseInlineCommandPrompt(
  text: string,
): InlineCommandPrompt | undefined {
  const bangOffset = text.search(/\S/);
  if (bangOffset === -1 || text[bangOffset] !== "!") return undefined;
  const command = text.slice(bangOffset + 1).trim();
  if (!command) return undefined;
  return { command, bangOffset };
}

export function isInlineCommandPrompt(text: string): boolean {
  return parseInlineCommandPrompt(text) !== undefined;
}

export function hasExecutableCommandBlocks(text: string): boolean {
  return findExecutableCommandBlocks(text).length > 0;
}

export function findExecutableCommandBlocks(
  text: string,
): ExecutableCommandBlock[] {
  const blocks: ExecutableCommandBlock[] = [];
  const lines = splitLinesWithOffsets(text);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const open = parseOpeningFence(line.text);
    if (!open) continue;

    const contentStart = line.offset + line.text.length;
    for (let closeIndex = index + 1; closeIndex < lines.length; closeIndex += 1) {
      const closeLine = lines[closeIndex];
      if (!isClosingFence(closeLine.text, open.fenceChar, open.fenceLength)) {
        continue;
      }
      const commandEnd = closeLine.offset;
      blocks.push({
        start: line.offset,
        end: closeLine.offset + closeLine.text.length,
        commandStart: contentStart,
        commandEnd,
        fenceChar: open.fenceChar,
        fenceLength: open.fenceLength,
        command: text.slice(contentStart, commandEnd).trim(),
      });
      index = closeIndex;
      break;
    }
  }

  return blocks.filter((block) => block.command.length > 0);
}

export function replaceExecutableCommandBlocks(
  text: string,
  replacements: ExecutableCommandBlockReplacement[],
): string {
  const ordered = [...replacements].sort((a, b) => a.block.start - b.block.start);
  let cursor = 0;
  let result = "";
  for (const replacement of ordered) {
    if (replacement.block.start < cursor) {
      throw new Error("Executable command block replacements overlap.");
    }
    result += text.slice(cursor, replacement.block.start);
    result += replacement.text;
    if (
      text[replacement.block.end - 1] === "\n" &&
      !replacement.text.endsWith("\n")
    ) {
      result += "\n";
    }
    cursor = replacement.block.end;
  }
  return result + text.slice(cursor);
}

type LineWithOffset = { text: string; offset: number };

type OpeningFence = {
  fenceChar: "`" | "~";
  fenceLength: number;
};

function splitLinesWithOffsets(text: string): LineWithOffset[] {
  const lines: LineWithOffset[] = [];
  let offset = 0;
  while (offset < text.length) {
    const newlineIndex = text.indexOf("\n", offset);
    const end = newlineIndex === -1 ? text.length : newlineIndex + 1;
    lines.push({ text: text.slice(offset, end), offset });
    offset = end;
  }
  if (text.length === 0) lines.push({ text: "", offset: 0 });
  return lines;
}

function stripLineEnding(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function parseOpeningFence(line: string): OpeningFence | undefined {
  const raw = stripLineEnding(line);
  const indent = raw.match(/^ {0,3}/)?.[0].length ?? 0;
  const body = raw.slice(indent);
  const match = body.match(/^(`{3,}|~{3,})(.*)$/);
  if (!match) return undefined;
  const fence = match[1];
  const info = match[2].trim();
  if (info !== "!!!") return undefined;
  return {
    fenceChar: fence[0] as "`" | "~",
    fenceLength: fence.length,
  };
}

function isClosingFence(
  line: string,
  fenceChar: "`" | "~",
  fenceLength: number,
): boolean {
  const raw = stripLineEnding(line);
  const pattern = new RegExp(
    `^ {0,3}${escapeRegex(fenceChar)}{${fenceLength},}\\s*$`,
  );
  return pattern.test(raw);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
