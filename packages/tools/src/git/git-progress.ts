import { StringDecoder } from "node:string_decoder";
import { GitCommandError, GitWorkflowError } from "./git-errors.js";

const commandFailureMessages = {
  "local-changes":
    "Commit or stash your local changes before retrying; Git would overwrite them.",
  "untracked-files":
    "Move or stash untracked files before retrying; Git would overwrite them.",
  "unmerged-files": "Resolve the existing merge conflicts before retrying.",
  "non-fast-forward":
    "The branches have diverged. Merge or rebase the changes before retrying.",
  "branch-not-merged":
    "This branch has unmerged changes. Merge or preserve them before deleting it.",
  timeout: "Git operation timed out. Check connectivity and retry.",
} as const;

const workflowFailureMessages: Readonly<Record<string, string>> = {
  GIT_INVALID_BRANCH_NAME: "Choose a valid Git branch name and retry.",
  GIT_BRANCH_NOT_FOUND:
    "The branch no longer exists. Refresh the branch list and retry.",
  GIT_REMOTE_BRANCH_DELETE_UNSUPPORTED:
    "Only local branches can be deleted here.",
  GIT_CURRENT_BRANCH_DELETE:
    "Switch to another branch before deleting the current branch.",
  GIT_BASE_BRANCH_DELETE:
    "The repository's base branch cannot be deleted here.",
  GIT_DETACHED_HEAD: "Switch to a branch before retrying this operation.",
  GIT_NO_REMOTE: "Configure a remote for this repository before retrying.",
  GIT_NO_UPSTREAM: "Configure an upstream tracking branch before retrying.",
};

export interface GitProgress {
  phase: string;
  completed?: number;
  total?: number;
}

const phases = new Set([
  "Enumerating objects",
  "Counting objects",
  "Compressing objects",
  "Receiving objects",
  "Resolving deltas",
  "Writing objects",
  "Updating files",
  "Checking out files",
  "Filtering content",
  "Updating worktree",
]);

/** Bounded streaming parser: Git uses CR as well as LF, and chunks may split UTF-8.
 * Only known phase labels escape stderr; hook/credential output stays indeterminate.
 */
export function gitProgressParser(
  report: (progress: GitProgress) => void,
): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let last = "";
  const emit = (value: GitProgress) => {
    const key = `${value.phase}:${value.completed ?? ""}`;
    if (key !== last) {
      last = key;
      report(value);
    }
  };
  return (chunk) => {
    pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
    const lines = pending.split(/[\r\n]/);
    pending = (lines.pop() ?? "").slice(-2048);
    for (const line of lines) {
      const match =
        /^(?:remote:\s*)?([A-Za-z][A-Za-z ]{0,60}):\s*(\d{1,3})%/.exec(line);
      if (!line.trim()) continue;
      if (!match || Number(match[2]) > 100 || !phases.has(match[1].trim())) {
        emit({ phase: "Working" });
        continue;
      }
      emit({
        phase: match[1].trim(),
        completed: Number(match[2]),
        total: 100,
      });
    }
  };
}

/** Never forward CLI output, URLs, hook messages, or credential-helper errors to Activity. */
export function safeGitFailure(error: unknown): {
  category: string;
  message: string;
} {
  if (
    error instanceof Error &&
    (error.message === "Git operation admission is full" ||
      error.message === "Git operation queue is full")
  )
    return {
      category: "capacity",
      message:
        "Git operation queue is full. Retry after other operations finish.",
    };
  if (error instanceof Error && error.name === "AbortError")
    return {
      category: "cancelled",
      message:
        "Git operation cancelled. Remote updates may already have completed.",
    };
  if (error instanceof GitWorkflowError) {
    if (error.cause instanceof GitCommandError)
      return safeGitFailure(error.cause);
    if (Object.hasOwn(workflowFailureMessages, error.code))
      return {
        category: error.code,
        message: workflowFailureMessages[error.code],
      };
  }
  if (error instanceof GitCommandError && error.failureCategory)
    return {
      category: error.failureCategory,
      message: commandFailureMessages[error.failureCategory],
    };
  return {
    category: "git",
    message:
      "Git operation failed. Check repository state, authentication and connectivity before retrying.",
  };
}
