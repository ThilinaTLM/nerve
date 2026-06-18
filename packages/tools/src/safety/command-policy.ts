import { parse as shellParse } from "shell-quote";

export function hasShellControlOperator(command: string): boolean {
  return (
    /[><|`$();]/.test(command) ||
    command.includes("&&") ||
    command.includes("||")
  );
}

export function isKnownReadOnlyCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || hasShellControlOperator(normalized)) return false;
  const first = normalized.split(" ")[0];
  if (["pwd", "ls", "find", "rg", "grep", "which", "cat"].includes(first))
    return true;
  if (normalized === "git status" || normalized.startsWith("git status "))
    return true;
  if (normalized === "git diff" || normalized.startsWith("git diff "))
    return true;
  if (normalized === "git log" || normalized.startsWith("git log "))
    return true;
  if (normalized === "git show" || normalized.startsWith("git show "))
    return true;
  return false;
}

export function hasDangerousCommandPattern(command: string): boolean {
  return /(^|\s)(rm\s+-rf|sudo|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+reset\s+--hard|git\s+clean\s+-fd|docker\s+system\s+prune|kubectl\s+delete)(\s|$)/.test(
    command,
  );
}

export function isLikelyLongRunningCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch)(\s|$)/.test(
      normalized,
    ) ||
    /(^|\s)(vite|next\s+dev|svelte-kit\s+dev|astro\s+dev|webpack\s+serve|nodemon|tsx\s+watch|tsc\s+--watch|cargo\s+watch)(\s|$)/.test(
      normalized,
    )
  );
}

type ParseEntry = string | { op?: string; comment?: string };

function isOpEntry(entry: ParseEntry): entry is { op: string } {
  return typeof entry === "object" && typeof entry.op === "string";
}

function isCommentEntry(entry: ParseEntry): entry is { comment: string } {
  return typeof entry === "object" && typeof entry.comment === "string";
}

function parseCommand(command: string): ParseEntry[] | null {
  try {
    const result = shellParse(command, (key: string) => `$${key}`);
    if (!Array.isArray(result)) return null;
    return result as ParseEntry[];
  } catch {
    return null;
  }
}

/** Detect $() and backtick command substitution outside single quotes. */
function hasCommandSubstitution(command: string): boolean {
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

function hasUnsafeConstructs(entries: ParseEntry[]): boolean {
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

function hasUnsafeRedirects(entries: ParseEntry[]): boolean {
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

function extractSegments(entries: ParseEntry[]): string[][] {
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

function stripEnvVarAssignments(tokens: string[]): string[] {
  let index = 0;
  while (
    index < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")
  ) {
    index++;
  }
  return tokens.slice(index);
}

function normalizeCommandName(command: string): string {
  return (command.split("/").pop() ?? command).trim();
}

function stripLeadingOptions(tokens: string[]): string[] {
  let index = 0;
  while (tokens[index]?.startsWith("-")) index++;
  return tokens.slice(index);
}

const WRAPPER_ROOT_COMMANDS = new Set([
  "command",
  "env",
  "nice",
  "nohup",
  "time",
  "timeout",
]);

function unwrapCommandTokens(tokens: string[]): string[] {
  let current = tokens;

  for (let depth = 0; depth < 5; depth++) {
    const rootCommand = normalizeCommandName(current[0] ?? "");
    if (!WRAPPER_ROOT_COMMANDS.has(rootCommand)) break;

    if (rootCommand === "env") {
      let index = 1;
      while (index < current.length) {
        const token = current[index];
        if (token === "-u" || token === "--unset" || token === "-S") {
          index += 2;
          continue;
        }
        if (token.startsWith("-")) {
          index++;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
          index++;
          continue;
        }
        break;
      }
      current = current.slice(index);
      continue;
    }

    if (rootCommand === "timeout") {
      const withoutOptions = stripLeadingOptions(current.slice(1));
      current = withoutOptions.slice(1);
      continue;
    }

    if (rootCommand === "nice") {
      let index = 1;
      if (current[index] === "-n") index += 2;
      else if (current[index]?.startsWith("-n")) index++;
      while (current[index]?.startsWith("-")) index++;
      current = current.slice(index);
      continue;
    }

    current = stripLeadingOptions(current.slice(1));
  }

  return current;
}

function getXargsInvokedCommandIndex(tokens: string[]): number | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token === "-E" ||
      token === "-I" ||
      token === "-L" ||
      token === "-P" ||
      token === "-d" ||
      token === "-n" ||
      token === "-s"
    ) {
      i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    return i;
  }
  return undefined;
}

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

function hasAnyToken(tokens: string[], blocked: Set<string>): boolean {
  return tokens.some((token) => blocked.has(token));
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

function isBlockedGitInvocation(tokens: string[]): boolean {
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

const BLOCKED_BASH_ROOT_COMMANDS = new Set([
  "chmod",
  "chgrp",
  "chown",
  "code",
  "cp",
  "dash",
  "dd",
  "doas",
  "emacs",
  "eval",
  "exec",
  "fish",
  "function",
  "kill",
  "killall",
  "ln",
  "mkdir",
  "mkfs",
  "mount",
  "mv",
  "nano",
  "pkill",
  "rm",
  "rmdir",
  "sh",
  "shred",
  "sudo",
  "tee",
  "touch",
  "truncate",
  "umount",
  "vi",
  "vim",
  "zsh",
]);

const INTERPRETER_EVAL_COMMANDS = new Set([
  "deno",
  "node",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
]);

const PACKAGE_MANAGER_ROOTS = new Set([
  "bun",
  "cargo",
  "corepack",
  "gem",
  "just",
  "make",
  "npm",
  "npx",
  "pip",
  "pip3",
  "pnpm",
  "task",
  "yarn",
]);

const SYSTEM_PACKAGE_MANAGER_ROOTS = new Set([
  "apt",
  "apt-get",
  "brew",
  "dnf",
  "yum",
]);

const MUTATING_PACKAGE_SUBCOMMANDS = new Set([
  "add",
  "audit",
  "autoclean",
  "autoremove",
  "ci",
  "clean",
  "create",
  "dedupe",
  "deploy",
  "dist-upgrade",
  "dlx",
  "doctor",
  "fix",
  "i",
  "import",
  "init",
  "install",
  "link",
  "pack",
  "patch",
  "patch-commit",
  "prune",
  "publish",
  "purge",
  "rebuild",
  "release",
  "remove",
  "rm",
  "set",
  "set-script",
  "unlink",
  "uninstall",
  "up",
  "update",
  "upgrade",
  "version",
]);

const PACKAGE_EXEC_SUBCOMMANDS = new Set(["exec"]);

const GENERIC_WRITE_OR_LONG_RUNNING_FLAGS = new Set([
  "--fix",
  "--update-snapshot",
  "--updateSnapshot",
  "--watch",
  "--watch-all",
  "--watchAll",
  "--write",
]);

const PACKAGE_OPTION_VALUE_FLAGS = new Set([
  "--config",
  "--dir",
  "--filter",
  "--global-dir",
  "--prefix",
  "--project",
  "--registry",
  "--store-dir",
  "--workspace",
  "-C",
  "-F",
  "-w",
]);

function hasGenericWriteOrLongRunningFlag(tokens: string[]): boolean {
  return tokens.some((token) => {
    if (GENERIC_WRITE_OR_LONG_RUNNING_FLAGS.has(token)) return true;
    return (
      token.startsWith("--fix=") ||
      token.startsWith("--watch=") ||
      token.startsWith("--write=")
    );
  });
}

function getPackageSubcommandIndex(tokens: string[]): number | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") return undefined;
    if (PACKAGE_OPTION_VALUE_FLAGS.has(token)) {
      i++;
      continue;
    }
    if (
      token.startsWith("--config=") ||
      token.startsWith("--dir=") ||
      token.startsWith("--filter=") ||
      token.startsWith("--global-dir=") ||
      token.startsWith("--prefix=") ||
      token.startsWith("--project=") ||
      token.startsWith("--registry=") ||
      token.startsWith("--store-dir=") ||
      token.startsWith("--workspace=")
    ) {
      continue;
    }
    if (token.startsWith("-")) continue;
    return i;
  }
  return undefined;
}

function nextNonOptionToken(
  tokens: string[],
  startIndex: number,
): string | undefined {
  for (let i = startIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") continue;
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

function isBlockedPackageScriptName(scriptName: string): boolean {
  const normalized = scriptName.toLowerCase();
  return /(^|[:_-])(build|codegen|deploy|dev|fix|format|generate|install|preview|publish|release|serve|start|update|watch|write)([:_-]|$)/.test(
    normalized,
  );
}

function isBlockedPackageManagerInvocation(tokens: string[]): boolean {
  const rootCommand = normalizeCommandName(tokens[0] ?? "");
  if (!PACKAGE_MANAGER_ROOTS.has(rootCommand)) return false;

  if (rootCommand === "npx" || rootCommand === "corepack") return true;
  if (hasGenericWriteOrLongRunningFlag(tokens)) return true;

  const subcommandIndex = getPackageSubcommandIndex(tokens);
  if (subcommandIndex === undefined) return false;

  const subcommand = tokens[subcommandIndex];
  const subcommandLower = subcommand.toLowerCase();

  if (PACKAGE_EXEC_SUBCOMMANDS.has(subcommandLower)) {
    const invoked = nextNonOptionToken(tokens, subcommandIndex + 1);
    if (!invoked) return false;
    const invokedIndex = tokens.indexOf(invoked, subcommandIndex + 1);
    return isBlockedCommandSegment(tokens.slice(invokedIndex));
  }

  if (subcommandLower === "run") {
    const scriptName = nextNonOptionToken(tokens, subcommandIndex + 1);
    return scriptName ? isBlockedPackageScriptName(scriptName) : false;
  }

  if (
    rootCommand === "pip" ||
    rootCommand === "pip3" ||
    rootCommand === "gem"
  ) {
    return MUTATING_PACKAGE_SUBCOMMANDS.has(subcommandLower);
  }

  if (MUTATING_PACKAGE_SUBCOMMANDS.has(subcommandLower)) return true;

  return isBlockedPackageScriptName(subcommandLower);
}

function isBlockedSystemPackageManagerInvocation(tokens: string[]): boolean {
  const rootCommand = normalizeCommandName(tokens[0] ?? "");
  if (!SYSTEM_PACKAGE_MANAGER_ROOTS.has(rootCommand)) return false;

  const subcommandIndex = getPackageSubcommandIndex(tokens);
  if (subcommandIndex === undefined) return false;
  return MUTATING_PACKAGE_SUBCOMMANDS.has(
    tokens[subcommandIndex].toLowerCase(),
  );
}

function isBlockedLongRunningInvocation(tokens: string[]): boolean {
  const rootCommand = normalizeCommandName(tokens[0] ?? "");

  if (
    ["less", "more", "sleep", "top", "htop", "watch", "yes"].includes(
      rootCommand,
    )
  ) {
    return true;
  }

  if (rootCommand === "tail") {
    return tokens.some((token) => token === "-f" || token === "--follow");
  }

  if (rootCommand === "ping") {
    return !tokens.some(
      (token) =>
        token === "-c" || token === "--count" || token.startsWith("-c"),
    );
  }

  return false;
}

function isBlockedByCommandOptions(tokens: string[]): boolean {
  const rootCommand = normalizeCommandName(tokens[0] ?? "");

  if (hasGenericWriteOrLongRunningFlag(tokens)) return true;

  if (rootCommand === "find" || rootCommand === "fd") {
    return hasAnyToken(
      tokens,
      new Set([
        "-X",
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-x",
        "--exec",
        "--exec-batch",
      ]),
    );
  }

  if (
    (rootCommand === "sed" || rootCommand === "perl") &&
    tokens.some((token) => token === "-i" || token.startsWith("-i."))
  ) {
    return true;
  }

  if (rootCommand === "curl" || rootCommand === "wget") {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (
        token === "-O" ||
        token === "-o" ||
        token === "--output" ||
        token === "--remote-name" ||
        token.startsWith("-O") ||
        token.startsWith("-o") ||
        token.startsWith("--output=")
      ) {
        return true;
      }

      const requestMethod =
        token === "-X" || token === "--request"
          ? tokens[i + 1]
          : token.startsWith("-X")
            ? token.slice(2)
            : token.startsWith("--request=")
              ? token.slice("--request=".length)
              : undefined;
      if (
        requestMethod &&
        !["GET", "HEAD", "OPTIONS"].includes(requestMethod.toUpperCase())
      ) {
        return true;
      }

      if (
        token === "-d" ||
        token === "-F" ||
        token === "--data" ||
        token === "--data-raw" ||
        token === "--form" ||
        token === "--post-data" ||
        token.startsWith("--data=") ||
        token.startsWith("--data-raw=") ||
        token.startsWith("--form=") ||
        token.startsWith("--post-data=")
      ) {
        return true;
      }
    }
  }

  if (INTERPRETER_EVAL_COMMANDS.has(rootCommand)) {
    if (
      tokens.some(
        (token) => token === "-c" || token === "-e" || token.startsWith("-e"),
      )
    ) {
      return true;
    }

    const moduleIndex = tokens.indexOf("-m");
    const moduleName = moduleIndex >= 0 ? tokens[moduleIndex + 1] : undefined;
    if (moduleName === "pip" || moduleName === "pip3") {
      return isBlockedCommandSegment(tokens.slice(moduleIndex + 1));
    }
  }

  return false;
}

function isBlockedCommandSegment(tokens: string[]): boolean {
  const stripped = stripEnvVarAssignments(tokens);
  const unwrapped = unwrapCommandTokens(stripped);
  if (unwrapped.length === 0) return false;

  const rootCommand = normalizeCommandName(unwrapped[0]);

  if (rootCommand === "xargs") {
    const invokedIndex = getXargsInvokedCommandIndex(unwrapped);
    if (invokedIndex === undefined) return false;
    return isBlockedCommandSegment(unwrapped.slice(invokedIndex));
  }

  if (BLOCKED_BASH_ROOT_COMMANDS.has(rootCommand)) return true;
  if (isBlockedLongRunningInvocation(unwrapped)) return true;
  if (isBlockedGitInvocation(unwrapped)) return true;
  if (isBlockedPackageManagerInvocation(unwrapped)) return true;
  if (isBlockedSystemPackageManagerInvocation(unwrapped)) return true;
  return isBlockedByCommandOptions(unwrapped);
}

export function isAllowedPlanModeBashCommand(command: string): boolean {
  if (!command.trim()) return false;
  if (isLikelyLongRunningCommand(command)) return false;
  if (hasCommandSubstitution(command)) return false;

  const entries = parseCommand(command);
  if (!entries || entries.length === 0) return false;
  if (hasUnsafeConstructs(entries)) return false;
  if (hasUnsafeRedirects(entries)) return false;

  const segments = extractSegments(entries);
  if (segments.length === 0) return false;

  return segments.every((segment) => !isBlockedCommandSegment(segment));
}
