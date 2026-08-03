export type DiffLineTone = "add" | "delete" | "hunk" | "file" | "context";

export type UnifiedDiffLine = {
  text: string;
  tone: DiffLineTone;
  oldLine?: number;
  newLine?: number;
};

function lineTone(line: string): DiffLineTone {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff ") ||
    line.startsWith("index ")
  )
    return "file";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "delete";
  return "context";
}

export function parseUnifiedDiff(patch: string): UnifiedDiffLine[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;

  return patch
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((text): UnifiedDiffLine => {
      const tone = lineTone(text);
      if (text.startsWith("diff ")) {
        oldLine = undefined;
        newLine = undefined;
      }
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        return { text, tone };
      }
      if (oldLine === undefined || newLine === undefined) return { text, tone };
      if (text.startsWith("\\")) return { text, tone };
      if (tone === "context" && !text.startsWith(" ")) return { text, tone };
      if (tone === "add") {
        const line = { text, tone, newLine };
        newLine += 1;
        return line;
      }
      if (tone === "delete") {
        const line = { text, tone, oldLine };
        oldLine += 1;
        return line;
      }
      const line = { text, tone, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return line;
    });
}
