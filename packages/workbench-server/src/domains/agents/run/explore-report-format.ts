import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PersistedExploreReport = {
  path: string;
  bytes: number;
  lines: number;
};

export function formatAgentReadyExploreReport(markdown: string): string {
  const output: string[] = [];
  let fenced = false;
  for (const sourceLine of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const line = sourceLine.trimEnd();
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      output.push(line);
      continue;
    }
    if (!fenced && line.length > 120 && /^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (!cells.every((cell) => /^:?-+:?$/.test(cell))) {
        output.push(...wrapProseLine(`- ${cells.join(" — ")}`, 120));
      }
      continue;
    }
    if (
      fenced ||
      line.length <= 120 ||
      /^\s*(?:https?:\/\/|\/|[A-Za-z]:\\)/.test(line) ||
      /^\s*\|.*\|\s*$/.test(line)
    ) {
      output.push(line);
      continue;
    }
    output.push(...wrapProseLine(line, 120));
  }
  return `${output.join("\n").trimEnd()}\n`;
}

export async function persistExploreReport(
  path: string,
  markdown: string,
): Promise<PersistedExploreReport> {
  const formatted = formatAgentReadyExploreReport(markdown);
  const bytes = Buffer.from(formatted, "utf8");
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    path,
    bytes: bytes.byteLength,
    lines: formatted.length === 0 ? 0 : formatted.split("\n").length - 1,
  };
}

function wrapProseLine(line: string, width: number): string[] {
  const prefix = line.match(/^\s*(?:[-*+] |\d+\. )/)?.[0] ?? "";
  const words = line.slice(prefix.length).split(/\s+/).filter(Boolean);
  const output: string[] = [];
  let current = prefix;
  for (const word of words) {
    if (word.length > width || /^https?:\/\//.test(word)) {
      if (current.trim()) output.push(current.trimEnd());
      output.push(word);
      current = prefix ? " ".repeat(prefix.length) : "";
      continue;
    }
    const candidate =
      current.trim().length === 0 ? `${current}${word}` : `${current} ${word}`;
    if (candidate.length <= width) current = candidate;
    else {
      output.push(current.trimEnd());
      current = `${prefix ? " ".repeat(prefix.length) : ""}${word}`;
    }
  }
  if (current.trim()) output.push(current.trimEnd());
  return output.length > 0 ? output : [line];
}
