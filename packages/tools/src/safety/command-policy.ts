import { isBlockedGitInvocation } from "./command-policy-git.js";
import {
  isBlockedByCommandOptions,
  isBlockedLongRunningInvocation,
} from "./command-policy-options.js";
import {
  isBlockedPackageManagerInvocation,
  isBlockedSystemPackageManagerInvocation,
} from "./command-policy-packages.js";
import {
  extractSegments,
  hasCommandSubstitution,
  hasUnsafeConstructs,
  hasUnsafeRedirects,
  parseCommand,
} from "./command-policy-parser.js";
import {
  getXargsInvokedCommandIndex,
  normalizeCommandName,
  stripEnvVarAssignments,
  unwrapCommandTokens,
} from "./command-policy-wrappers.js";

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
  if (isBlockedPackageManagerInvocation(unwrapped, isBlockedCommandSegment)) {
    return true;
  }
  if (isBlockedSystemPackageManagerInvocation(unwrapped)) return true;
  return isBlockedByCommandOptions(unwrapped, isBlockedCommandSegment);
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
