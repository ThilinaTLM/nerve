import { hasGenericWriteOrLongRunningFlag } from "./command-policy-options.js";
import { normalizeCommandName } from "./command-policy-wrappers.js";

export type SegmentBlocker = (tokens: string[]) => boolean;

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

export function isBlockedPackageManagerInvocation(
  tokens: string[],
  isBlockedCommandSegment: SegmentBlocker,
): boolean {
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

export function isBlockedSystemPackageManagerInvocation(
  tokens: string[],
): boolean {
  const rootCommand = normalizeCommandName(tokens[0] ?? "");
  if (!SYSTEM_PACKAGE_MANAGER_ROOTS.has(rootCommand)) return false;

  const subcommandIndex = getPackageSubcommandIndex(tokens);
  if (subcommandIndex === undefined) return false;
  return MUTATING_PACKAGE_SUBCOMMANDS.has(
    tokens[subcommandIndex].toLowerCase(),
  );
}
