import type { GitFileChange, GitStatusCode } from "@nervekit/shared";

export interface PorcelainBranchInfo {
  head: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export interface PorcelainStatus {
  branch: PorcelainBranchInfo;
  files: GitFileChange[];
}

function toStatusCode(char: string): GitStatusCode {
  switch (char) {
    case "M":
    case "A":
    case "D":
    case "R":
    case "C":
    case "U":
    case "?":
    case "!":
      return char;
    default:
      return " ";
  }
}

/**
 * Parse the output of `git status --porcelain=v2 --branch`.
 *
 * Pure and dependency-free so it can be unit tested without spawning git.
 */
export function parsePorcelainV2(stdout: string): PorcelainStatus {
  const branch: PorcelainBranchInfo = {
    head: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
  };
  const files: GitFileChange[] = [];

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) continue;

    if (line.startsWith("# ")) {
      const header = line.slice(2);
      if (header.startsWith("branch.head ")) {
        const value = header.slice("branch.head ".length).trim();
        if (value === "(detached)") {
          branch.detached = true;
          branch.head = null;
        } else {
          branch.head = value;
        }
      } else if (header.startsWith("branch.upstream ")) {
        branch.upstream = header.slice("branch.upstream ".length).trim();
      } else if (header.startsWith("branch.ab ")) {
        const aheadBehind = parseBranchAheadBehind(header);
        if (aheadBehind) {
          branch.ahead = aheadBehind.ahead;
          branch.behind = aheadBehind.behind;
        }
      }
      continue;
    }

    const kind = line[0];
    if (kind === "1") {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = line.split(" ").slice(8).join(" ");
      files.push(buildChange(xy, path));
    } else if (kind === "2") {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\t<origPath>
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const rest = line.split(" ").slice(9).join(" ");
      const [path, renamedFrom] = rest.split("\t");
      const change = buildChange(xy, path);
      if (renamedFrom) change.renamedFrom = renamedFrom;
      files.push(change);
    } else if (kind === "u") {
      // u <XY> ... <path>
      const parts = line.split(" ");
      const xy = parts[1] ?? "UU";
      const path = line.split(" ").slice(10).join(" ");
      files.push({
        path,
        index: toStatusCode(xy[0] ?? "U"),
        worktree: toStatusCode(xy[1] ?? "U"),
        staged: false,
        untracked: false,
      });
    } else if (kind === "?") {
      const path = line.slice(2);
      files.push({
        path,
        index: "?",
        worktree: "?",
        staged: false,
        untracked: true,
      });
    } else if (kind === "!") {
      const path = line.slice(2);
      files.push({
        path,
        index: "!",
        worktree: "!",
        staged: false,
        untracked: false,
      });
    }
  }

  return { branch, files };
}

function buildChange(xy: string, path: string): GitFileChange {
  const indexChar = xy[0] ?? ".";
  const worktreeChar = xy[1] ?? ".";
  return {
    path,
    index: toStatusCode(indexChar),
    worktree: toStatusCode(worktreeChar),
    staged: indexChar !== "." && indexChar !== " ",
    untracked: false,
  };
}

/** Parse `git diff --shortstat` output into insertion/deletion counts. */
export function parseShortstat(stdout: string): {
  insertions: number;
  deletions: number;
} {
  return {
    insertions: parseCountBeforeLabel(stdout, " insertion"),
    deletions: parseCountBeforeLabel(stdout, " deletion"),
  };
}

function parseBranchAheadBehind(
  header: string,
): { ahead: number; behind: number } | null {
  const value = header.slice("branch.ab ".length).trim();
  const separatorIndex = value.indexOf(" ");
  if (separatorIndex < 0) return null;

  const ahead = parsePrefixedUnsignedInteger(
    value.slice(0, separatorIndex),
    "+",
  );
  const behind = parsePrefixedUnsignedInteger(
    value.slice(separatorIndex + 1),
    "-",
  );
  return ahead === null || behind === null ? null : { ahead, behind };
}

function parseCountBeforeLabel(text: string, label: string): number {
  const labelIndex = text.indexOf(label);
  if (labelIndex < 0) return 0;

  let end = labelIndex;
  while (end > 0 && text[end - 1] === " ") end -= 1;

  let start = end;
  while (start > 0 && isAsciiDigit(text.charCodeAt(start - 1))) start -= 1;

  return start === end ? 0 : Number(text.slice(start, end));
}

function parsePrefixedUnsignedInteger(
  value: string,
  prefix: string,
): number | null {
  if (!value.startsWith(prefix)) return null;
  const digits = value.slice(prefix.length);
  if (digits.length === 0) return null;
  for (let index = 0; index < digits.length; index += 1) {
    if (!isAsciiDigit(digits.charCodeAt(index))) return null;
  }
  return Number(digits);
}

function isAsciiDigit(charCode: number): boolean {
  return charCode >= 48 && charCode <= 57;
}
