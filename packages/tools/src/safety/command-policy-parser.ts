import { parse as shellParse } from "shell-quote";

export type ParseEntry = string | { op?: string; comment?: string };

function isOpEntry(entry: ParseEntry): entry is { op: string } {
  return typeof entry === "object" && typeof entry.op === "string";
}

function isCommentEntry(entry: ParseEntry): entry is { comment: string } {
  return typeof entry === "object" && typeof entry.comment === "string";
}

export function parseCommand(command: string): ParseEntry[] | null {
  try {
    const result = shellParse(command, (key: string) => `$${key}`);
    if (!Array.isArray(result)) return null;
    return result as ParseEntry[];
  } catch {
    return null;
  }
}

/** Detect $() and backtick command substitution outside single quotes. */
export function hasCommandSubstitution(command: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inDoubleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote) {
      if (char === "$" && command[i + 1] === "(") return true;
      if (char === "`") return true;
    }
  }

  return false;
}

export function hasUnsafeConstructs(entries: ParseEntry[]): boolean {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isOpEntry(entry)) continue;

    const op = entry.op;

    if (op === "<(" || op === ">(") return true;
    if (op === "(" || op === ")") return true;
    if (op === "<<<") return true;

    if (op === "&") {
      const next = entries[i + 1];
      if (
        i + 2 < entries.length &&
        isOpEntry(next) &&
        next.op === ">" &&
        entries[i + 2] === "/dev/null"
      ) {
        continue;
      }
      return true;
    }
  }

  return false;
}

export function hasUnsafeRedirects(entries: ParseEntry[]): boolean {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isOpEntry(entry)) continue;

    const op = entry.op;

    if (op === ">" || op === ">>") {
      const target = entries[i + 1];
      if (typeof target === "string" && target === "/dev/null") {
        i++;
        continue;
      }
      return true;
    }

    if (op === "<") return true;

    if (op === ">&") {
      const target = entries[i + 1];
      if (typeof target === "string" && /^\d$/.test(target)) {
        i++;
        continue;
      }
      return true;
    }
  }

  return false;
}

export function extractSegments(entries: ParseEntry[]): string[][] {
  const segments: string[][] = [[]];

  for (const entry of entries) {
    if (isCommentEntry(entry)) continue;

    if (typeof entry === "string") {
      segments[segments.length - 1].push(entry);
      continue;
    }

    if (!isOpEntry(entry)) continue;

    if (["|", "||", "&&", ";"].includes(entry.op)) {
      if (segments[segments.length - 1].length > 0) segments.push([]);
    }
  }

  return segments.filter((segment) => segment.length > 0);
}
