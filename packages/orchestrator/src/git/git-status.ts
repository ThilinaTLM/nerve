import type { GitFileChange, GitStatusCode } from "@nerve/shared";

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
    const line = rawLine.replace(/\r$/, "");
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
        const match = header.match(/branch\.ab \+(-?\d+) -(-?\d+)/);
        if (match) {
          branch.ahead = Number(match[1]);
          branch.behind = Number(match[2]);
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
  const insertionsMatch = stdout.match(/(\d+) insertion/);
  const deletionsMatch = stdout.match(/(\d+) deletion/);
  return {
    insertions: insertionsMatch ? Number(insertionsMatch[1]) : 0,
    deletions: deletionsMatch ? Number(deletionsMatch[1]) : 0,
  };
}
