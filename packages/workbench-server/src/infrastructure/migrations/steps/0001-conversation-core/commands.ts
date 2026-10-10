export interface CommandBlock {
  start: number;
  end: number;
  command: string;
}
/** Frozen 0.34.1 executable-fence grammar; no commands are ever executed. */
export function findExecutableCommandBlocks(text: string): CommandBlock[] {
  const lines: { text: string; offset: number }[] = [];
  for (let offset = 0; offset < text.length;) {
    const newline = text.indexOf("\n", offset),
      end = newline < 0 ? text.length : newline + 1;
    lines.push({ text: text.slice(offset, end), offset });
    offset = end;
  }
  const blocks: CommandBlock[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      open = line.text.replace(/\r?\n$/, "").match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!open || open[2].trim() !== "!!!") continue;
    for (let end = index + 1; end < lines.length; end++) {
      if (
        !new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`).test(
          lines[end].text.replace(/\r?\n$/, ""),
        )
      )
        continue;
      const command = text
        .slice(line.offset + line.text.length, lines[end].offset)
        .trim();
      if (command)
        blocks.push({
          start: line.offset,
          end: lines[end].offset + lines[end].text.length,
          command,
        });
      index = end;
      break;
    }
  }
  return blocks;
}
export function replaceExecutableCommandBlocks(
  text: string,
  replacements: { block: CommandBlock; text: string }[],
): string {
  let cursor = 0,
    result = "";
  for (const replacement of [...replacements].sort(
    (a, b) => a.block.start - b.block.start,
  )) {
    if (replacement.block.start < cursor)
      throw new Error("Overlapping command receipts");
    result += text.slice(cursor, replacement.block.start) + replacement.text;
    if (
      text[replacement.block.end - 1] === "\n" &&
      !replacement.text.endsWith("\n")
    )
      result += "\n";
    cursor = replacement.block.end;
  }
  return result + text.slice(cursor);
}
