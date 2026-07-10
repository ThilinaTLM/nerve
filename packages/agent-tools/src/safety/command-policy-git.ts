import {
  hasAnyToken,
  normalizeCommandName,
} from "./command-policy-wrappers.js";

function getGitSubcommandIndex(tokens: string[]): number | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token === "-C" ||
      token === "-c" ||
      token === "--git-dir" ||
      token === "--namespace" ||
      token === "--work-tree"
    ) {
      i++;
      continue;
    }
    if (
      token === "--bare" ||
      token === "--no-pager" ||
      token === "--paginate" ||
      token.startsWith("--git-dir=") ||
      token.startsWith("--namespace=") ||
      token.startsWith("--work-tree=")
    ) {
      continue;
    }
    if (token.startsWith("-")) continue;
    return i;
  }
  return undefined;
}

const BLOCKED_GIT_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "fetch",
  "gc",
  "init",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reflog",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "submodule",
  "switch",
  "tag",
  "worktree",
]);

export function isBlockedGitInvocation(tokens: string[]): boolean {
  const rootCommand = normalizeCommandName(tokens[0] ?? "");
  if (rootCommand !== "git") return false;

  const subcommandIndex = getGitSubcommandIndex(tokens);
  if (subcommandIndex === undefined) return false;

  const subcommand = tokens[subcommandIndex];
  const args = tokens.slice(subcommandIndex + 1);

  if (subcommand === "branch") {
    return hasAnyToken(
      args,
      new Set(["-d", "-D", "-m", "-M", "--delete", "--move"]),
    );
  }

  if (subcommand === "config") {
    return !args.some(
      (arg) =>
        arg === "--get" ||
        arg === "--get-all" ||
        arg === "--get-regexp" ||
        arg === "--list" ||
        arg === "--name-only" ||
        arg === "--show-origin" ||
        arg === "-l",
    );
  }

  if (subcommand === "diff") {
    return args.some(
      (arg) => arg === "--output" || arg.startsWith("--output="),
    );
  }

  if (subcommand === "remote") {
    const remoteAction = args.find((arg) => !arg.startsWith("-"));
    return !(
      remoteAction === undefined ||
      remoteAction === "get-url" ||
      remoteAction === "show"
    );
  }

  return BLOCKED_GIT_SUBCOMMANDS.has(subcommand);
}
