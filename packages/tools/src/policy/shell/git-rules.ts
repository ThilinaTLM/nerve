import { normalizeCommandName } from "./wrappers.js";

interface GitReadRule {
  /** Permitted first positional argument ("" = none). Absent = any. */
  forms?: readonly string[];
  /** Rejected first positional arguments (mutating sub-forms). */
  denyForms?: readonly string[];
  /** If set, every flag must be in this set. */
  onlyFlags?: readonly string[];
  /** If set, at least one of these flags is required to allow positionals / be read-only. */
  requireAnyFlag?: readonly string[];
  /** Flags that, together with positionals, still denote listing (branch, tag). */
  listFlags?: readonly string[];
}

/** Flags that run a program or write a file; rejected for every subcommand. */
const GLOBAL_DENY: readonly (string | RegExp)[] = [
  /^--output(=|$)/,
  "--ext-diff",
  /^--open-files-in-pager(=|$)/,
  /^-O/,
  /^--exec-path(=|$)/,
];

/** Global options with a separate value argument. */
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
]);

const SAFE_GLOBAL_FLAGS = new Set([
  "--no-pager",
  "--paginate",
  "--no-optional-locks",
  "--bare",
]);

const SAFE_GLOBAL_VALUE_PREFIXES = [
  "--git-dir=",
  "--work-tree=",
  "--namespace=",
];

const BRANCH_TAG_LIST_FLAGS = [
  "--list",
  "-l",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
];

const READ_ONLY_GIT: Record<string, GitReadRule> = {
  status: {},
  log: {},
  diff: {},
  show: {},
  // `git reflog <ref>` is `show <ref>`; only expire/delete mutate.
  reflog: { denyForms: ["expire", "delete"] },
  version: {},
  shortlog: {},
  describe: {},
  blame: {},
  "rev-parse": {},
  "ls-files": {},
  "ls-tree": {},
  "cat-file": { onlyFlags: ["-p", "-t", "-s", "-e"] },
  grep: {},
  "show-ref": {},
  "merge-base": {},
  "name-rev": {},
  "for-each-ref": {},
  branch: {
    onlyFlags: [
      ...BRANCH_TAG_LIST_FLAGS,
      "-a",
      "-r",
      "--show-current",
      "-v",
      "-vv",
      "--sort",
      "--format",
    ],
    listFlags: BRANCH_TAG_LIST_FLAGS,
  },
  tag: {
    onlyFlags: [...BRANCH_TAG_LIST_FLAGS, "-n", "--sort", "--format"],
    listFlags: [...BRANCH_TAG_LIST_FLAGS, "-n"],
  },
  remote: { forms: ["", "show", "get-url"], onlyFlags: ["-v", "--verbose"] },
  config: {
    onlyFlags: [
      "--get",
      "--get-all",
      "--get-regexp",
      "--list",
      "-l",
      "--name-only",
      "--show-origin",
      "--local",
      "--global",
      "--system",
      "--worktree",
      "--type",
      "--default",
      "-z",
      "--null",
    ],
    requireAnyFlag: ["--get", "--get-all", "--get-regexp", "--list", "-l"],
  },
  worktree: { forms: ["list"] },
  stash: { forms: ["list", "show"] },
};

function matchesFlag(arg: string, pattern: string | RegExp): boolean {
  return typeof pattern === "string" ? arg === pattern : pattern.test(arg);
}

function flagName(arg: string): string {
  const eq = arg.indexOf("=");
  return eq === -1 ? arg : arg.slice(0, eq);
}

/** Returns the subcommand index, or undefined if a global option is not in the safe set. */
function getGitSubcommandIndex(tokens: string[]): number | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      i++;
      continue;
    }
    if (
      SAFE_GLOBAL_FLAGS.has(token) ||
      SAFE_GLOBAL_VALUE_PREFIXES.some((prefix) => token.startsWith(prefix))
    ) {
      continue;
    }
    if (token.startsWith("-")) return undefined;
    return i;
  }
  return undefined;
}

export function isReadOnlyGitInvocation(tokens: string[]): boolean {
  if (normalizeCommandName(tokens[0] ?? "") !== "git") return false;
  if (tokens.length === 2 && tokens[1] === "--version") return true;
  const subcommandIndex = getGitSubcommandIndex(tokens);
  if (subcommandIndex === undefined) return false;

  const subcommand = tokens[subcommandIndex];
  if (!Object.hasOwn(READ_ONLY_GIT, subcommand)) return false;
  const rule = READ_ONLY_GIT[subcommand];
  const args = tokens.slice(subcommandIndex + 1);

  if (args.some((arg) => GLOBAL_DENY.some((p) => matchesFlag(arg, p)))) {
    return false;
  }

  const flags = args.filter((arg) => arg.startsWith("-") && arg !== "--");
  const positionals = args.filter((arg) => !arg.startsWith("-"));

  if (rule.forms && !rule.forms.includes(positionals[0] ?? "")) return false;
  if (rule.denyForms?.includes(positionals[0] ?? "")) return false;

  if (rule.onlyFlags) {
    const only = new Set(rule.onlyFlags);
    // `git tag -n5` style numeric suffix.
    const allowed = (flag: string) =>
      only.has(flagName(flag)) ||
      (only.has("-n") && /^-n\d+$/.test(flag)) ||
      (only.has("-v") && /^-v+$/.test(flag));
    if (!flags.every(allowed)) return false;
  }

  if (rule.requireAnyFlag) {
    const required = new Set(rule.requireAnyFlag);
    if (!flags.some((flag) => required.has(flagName(flag)))) return false;
  }

  // `git branch <name>` / `git tag <name>` create refs unless listing.
  if (rule.listFlags && positionals.length > 0) {
    const list = new Set(rule.listFlags);
    if (
      !flags.some((flag) => list.has(flagName(flag)) || /^-n\d+$/.test(flag))
    ) {
      return false;
    }
  }

  return true;
}

export function isBlockedGitInvocation(tokens: string[]): boolean {
  if (normalizeCommandName(tokens[0] ?? "") !== "git") return false;
  return !isReadOnlyGitInvocation(tokens);
}
