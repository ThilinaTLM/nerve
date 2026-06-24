import {
  hasAnyToken,
  normalizeCommandName,
} from "./command-policy-wrappers.js";

type SegmentBlocker = (tokens: string[]) => boolean;

const INTERPRETER_EVAL_COMMANDS = new Set([
  "deno",
  "node",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
]);

const GENERIC_WRITE_OR_LONG_RUNNING_FLAGS = new Set([
  "--fix",
  "--update-snapshot",
  "--updateSnapshot",
  "--watch",
  "--watch-all",
  "--watchAll",
  "--write",
]);

export function hasGenericWriteOrLongRunningFlag(tokens: string[]): boolean {
  return tokens.some((token) => {
    if (GENERIC_WRITE_OR_LONG_RUNNING_FLAGS.has(token)) return true;
    return (
      token.startsWith("--fix=") ||
      token.startsWith("--watch=") ||
      token.startsWith("--write=")
    );
  });
}

export function isBlockedLongRunningInvocation(tokens: string[]): boolean {
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

export function isBlockedByCommandOptions(
  tokens: string[],
  isBlockedCommandSegment: SegmentBlocker,
): boolean {
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
