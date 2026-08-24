import { isBlockedCommandSegment } from "../safety/command-policy.js";
import {
  extractSegments,
  hasCommandSubstitution,
  hasUnsafeConstructs,
  hasUnsafeRedirects,
  parseCommand,
} from "../safety/command-policy-parser.js";
import {
  getXargsInvokedCommandIndex,
  normalizeCommandName,
  stripEnvVarAssignments,
  unwrapCommandTokens,
} from "../safety/command-policy-wrappers.js";
import type { ShellCommandAssessment } from "./types.js";

const READ_ONLY_ROOTS = new Set([
  "cat",
  "df",
  "du",
  "fd",
  "file",
  "find",
  "grep",
  "head",
  "ls",
  "printf",
  "ps",
  "pwd",
  "rg",
  "stat",
  "tail",
  "test",
  "true",
  "false",
  "wc",
  "which",
]);

function normalizedInvocation(tokens: string[]): string[] {
  return unwrapCommandTokens(stripEnvVarAssignments(tokens));
}

function isReadOnlySegment(tokens: string[]): boolean {
  const normalized = normalizedInvocation(tokens);
  if (normalized.length === 0 || isBlockedCommandSegment(tokens)) return false;
  const root = normalizeCommandName(normalized[0] ?? "");
  if (root === "git") return true;
  if (root === "xargs") {
    const index = getXargsInvokedCommandIndex(normalized);
    return index !== undefined && isReadOnlySegment(normalized.slice(index));
  }
  return READ_ONLY_ROOTS.has(root);
}

export function assessShellCommand(command: string): ShellCommandAssessment {
  if (!command.trim())
    return unsupported("Empty commands are not treated as read-only.");
  if (
    /(^|\s)(rm\s+-rf|sudo|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+reset\s+--hard|git\s+clean\s+-fd|docker\s+system\s+prune|kubectl\s+delete)(\s|$)/.test(
      command,
    )
  ) {
    return {
      risk: "destructive",
      summary: "The command contains a known destructive operation.",
      segments: [],
      supported: true,
    };
  }
  if (hasCommandSubstitution(command))
    return unsupported("Command substitution requires approval.");
  const entries = parseCommand(command);
  if (!entries?.length)
    return unsupported("The shell command could not be parsed safely.");
  if (hasUnsafeConstructs(entries) || hasUnsafeRedirects(entries)) {
    return unsupported(
      "The command uses mutating or unsupported shell syntax.",
    );
  }
  const segments = extractSegments(entries).map((tokens) => {
    const normalizedTokens = normalizedInvocation(tokens);
    const readOnly = isReadOnlySegment(tokens);
    return {
      tokens,
      normalizedTokens,
      risk: readOnly ? ("read" as const) : ("command" as const),
      reason: readOnly
        ? "Known read-only command segment."
        : "The command segment may have side effects.",
    };
  });
  const readOnly =
    segments.length > 0 && segments.every((segment) => segment.risk === "read");
  return {
    risk: readOnly ? "read" : "command",
    summary: readOnly
      ? "Every command segment is known read-only."
      : "At least one command segment may have side effects.",
    segments,
    supported: true,
  };
}

function unsupported(summary: string): ShellCommandAssessment {
  return { risk: "command", summary, segments: [], supported: false };
}

export function commandPrefixMatches(
  tokens: readonly string[],
  prefix: readonly string[],
): boolean {
  if (prefix.length === 0 || prefix.length > tokens.length) return false;
  return prefix.every((token, index) => {
    const candidate = tokens[index] ?? "";
    return index === 0
      ? normalizeCommandName(candidate) === normalizeCommandName(token)
      : candidate === token;
  });
}

export function suggestedCommandPrefix(tokens: readonly string[]): string[] {
  const normalized = normalizedInvocation([...tokens]);
  if (normalized.length === 0) return [];
  const prefix = [normalizeCommandName(normalized[0] ?? "")];
  for (const token of normalized.slice(1)) {
    if (token.startsWith("-")) break;
    prefix.push(token);
    if (prefix.length === 3) break;
  }
  return prefix;
}
