import type {
  PermissionOverlayDocument,
  PermissionRule,
  PermissionRuleFilter,
  PermissionRuleSet,
  TargetMatcher,
} from "@nervekit/contracts/permissions";
import { code, codeList, line, type ReviewLine } from "./review-lines.js";

/** At most this many rules get a line of their own; the rest are counted. */
const MAX_RULE_LINES = 12;

const ROOT_NAMES = {
  project: "the project",
  nerve_home: "the Nerve home folder",
  nerve_data: "Nerve's data folder",
  plans: "the plans folder",
} as const;

const RISK_PHRASES: Record<string, string> = {
  read: "reading",
  write: "file changes",
  external_read: "reading from outside services",
  external_write: "changes to outside services",
  secret: "reading secrets",
  destructive: "destructive actions",
  deployment: "deployments",
  agent_spawn: "starting sub-agents",
  interaction: "questions to you",
  unknown: "calls Nerve cannot classify",
};

const KIND_PHRASES: Record<string, string> = {
  filesystem: "file access",
  command: "shell commands",
  code: "running code",
  external_read: "reading from outside services",
  interaction: "questions to you",
  orchestration: "sub-agent work",
  deployment: "deployments",
  integration: "integration calls",
  other: "other tools",
};

/** Risks whose calls change something; an allow on them acts without asking. */
const ACTING_RISKS = new Set([
  "write",
  "external_write",
  "secret",
  "destructive",
  "deployment",
  "agent_spawn",
  "unknown",
]);
/** Risks that are wide enough to warn about when allowed with no narrower condition. */
const BROAD_RISKS = new Set([
  "external_write",
  "secret",
  "destructive",
  "deployment",
]);
const SHELL_TOOLS = new Set(["bash", "async_bash"]);
const CODE_TOOLS = new Set(["python_exec"]);
const ACTING_TOOLS = new Set([
  "bash",
  "async_bash",
  "python_exec",
  "edit",
  "write",
]);

function matchers(when: PermissionRuleFilter): TargetMatcher[] {
  return [when.primaryTarget, when.targets?.matcher].filter(
    (entry): entry is TargetMatcher => entry !== undefined,
  );
}

const isUnconditional = (when: PermissionRuleFilter) =>
  Object.keys(when).length === 0;

function reachesRoot(when: PermissionRuleFilter, roots: readonly string[]) {
  return matchers(when).find(
    (entry) => entry.root !== undefined && roots.includes(entry.root),
  );
}

function plansOnly(when: PermissionRuleFilter): boolean {
  const found = matchers(when);
  return found.length > 0 && found.every((entry) => entry.root === "plans");
}

/** A command pattern that starts with a wildcard matches nearly any command line. */
const wideGlob = (pattern: string) => /^[*?{[]/.test(pattern);

function valueList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map((entry) => String(entry));
}

/** What the rule's primary argument (a command line) narrows it to, or undefined when it does not. */
function commandPhrase(when: PermissionRuleFilter): {
  phrase: string;
  wide: boolean;
} {
  const matcher = when.primaryArgument;
  if (!matcher) return { phrase: "any shell command", wide: true };
  if (matcher.operator === "equals" || matcher.operator === "in")
    return { phrase: codeList(valueList(matcher.value)), wide: false };
  if (matcher.operator === "glob")
    return {
      phrase: `commands matching ${code(matcher.value)}`,
      wide: wideGlob(matcher.value),
    };
  return { phrase: "shell commands with a condition", wide: false };
}

function targetPhrase(entry: TargetMatcher): string {
  const access =
    entry.access === "write"
      ? "changes to"
      : entry.access === "read"
        ? "reads of"
        : "access to";
  const root = entry.root ? ROOT_NAMES[entry.root] : undefined;
  if (entry.pattern)
    return `${access} ${code(entry.pattern)}${root ? ` in ${root}` : ""}`;
  return `${access} ${root ?? "files"}`;
}

function toolPhrase(when: PermissionRuleFilter): string {
  if (when.toolNames) return codeList(when.toolNames);
  if (when.toolGroups) return `${codeList(when.toolGroups)} calls`;
  if (when.toolKinds)
    return when.toolKinds.map((kind) => KIND_PHRASES[kind] ?? kind).join(", ");
  if (when.baseRisks)
    return when.baseRisks.map((risk) => RISK_PHRASES[risk] ?? risk).join(", ");
  return "calls with a condition";
}

type Described = { phrase: string; broad: boolean; acting: boolean };

/**
 * What an `allow` rule lets through, and whether that is wide: no condition at all, any shell
 * command or code, the Nerve home or data folder, or changes outside the machine.
 */
function describeAllow(when: PermissionRuleFilter): Described {
  if (isUnconditional(when))
    return { phrase: "every call", broad: true, acting: true };
  const toolNames = when.toolNames ?? [];
  const shell =
    toolNames.some((name) => SHELL_TOOLS.has(name)) ||
    (toolNames.length === 0 && when.toolKinds?.includes("command") === true);
  if (shell) {
    const command = commandPhrase(when);
    return {
      phrase: command.phrase,
      broad: command.wide && !when.arguments,
      acting: true,
    };
  }
  if (toolNames.some((name) => CODE_TOOLS.has(name)))
    return {
      phrase: "any Python code",
      broad: !when.arguments && !when.primaryArgument,
      acting: true,
    };
  const home = reachesRoot(when, ["nerve_home", "nerve_data"]);
  if (home)
    return {
      phrase: targetPhrase(home),
      broad: true,
      acting: true,
    };
  const risks = when.baseRisks ?? [];
  const targetless = matchers(when).length === 0 && !when.arguments;
  const phrase =
    matchers(when).length > 0
      ? targetPhrase(matchers(when)[0])
      : toolPhrase(when);
  const broad = targetless && risks.some((risk) => BROAD_RISKS.has(risk));
  const acting =
    !plansOnly(when) &&
    (risks.some((risk) => ACTING_RISKS.has(risk)) ||
      toolNames.some((name) => ACTING_TOOLS.has(name)) ||
      (when.toolKinds ?? []).some(
        (kind) =>
          kind === "command" || kind === "code" || kind === "deployment",
      ));
  return { phrase, broad, acting };
}

/** What a `prompt` or `deny` rule covers. */
function describeCovered(when: PermissionRuleFilter): string {
  if (isUnconditional(when)) return "everything else";
  const toolNames = when.toolNames ?? [];
  if (toolNames.some((name) => SHELL_TOOLS.has(name)))
    return commandPhrase(when).phrase;
  if (matchers(when).length > 0) return targetPhrase(matchers(when)[0]);
  return toolPhrase(when);
}

function ruleLine(rule: PermissionRule, suffix: string): ReviewLine {
  if (rule.decision === "allow") {
    const { phrase, broad } = describeAllow(rule.when);
    return line(`Allows ${phrase} without asking${suffix}`, broad);
  }
  const phrase = describeCovered(rule.when);
  return line(
    rule.decision === "prompt"
      ? `Asks before ${phrase}${suffix}`
      : `Refuses ${phrase}${suffix}`,
  );
}

function ruleLines(
  rules: readonly PermissionRule[],
  suffix: string,
): ReviewLine[] {
  const enabled = rules.filter((rule) => rule.enabled);
  // Broad rules first so a long file never hides them behind the cut.
  const all = enabled.map((rule) => ruleLine(rule, suffix));
  const ordered = [
    ...all.filter((entry) => entry.broad),
    ...all.filter((entry) => !entry.broad),
  ];
  const shown = ordered.slice(0, MAX_RULE_LINES);
  const more = ordered.length - shown.length;
  return more > 0
    ? [
        ...shown,
        line(`And ${more} more ${more === 1 ? "rule" : "rules"}`, false),
      ]
    : shown;
}

/** The lines of one permission rule set file. */
export function ruleSetLines(ruleSet: PermissionRuleSet): ReviewLine[] {
  const lines = ruleLines(ruleSet.rules, "");
  if (!ruleSet.enabled)
    lines.push(line("Disabled: it cannot be selected", false));
  return lines;
}

/** The lines of a permission overlay file; with several rule sets each line names its own. */
export function overlayLines(
  document: PermissionOverlayDocument,
): ReviewLine[] {
  const many = document.overlays.length > 1;
  const lines = document.overlays.flatMap((overlay) =>
    ruleLines(
      overlay.rules,
      many ? ` while ${code(overlay.ruleSetId)} is selected` : "",
    ),
  );
  return lines.length > 0 ? lines : [line("Adds no rules", false)];
}

/**
 * Whether selecting this rule set lets an agent run commands or edit files without asking:
 * an allow with no condition, any command, the Nerve folders or outside changes, or one on
 * a risk that changes something (outside the plans folder).
 */
export function ruleSetActsWithoutAsking(ruleSet: PermissionRuleSet): boolean {
  return ruleSet.rules.some((rule) => {
    if (!rule.enabled || rule.decision !== "allow") return false;
    const { broad, acting } = describeAllow(rule.when);
    return broad || acting;
  });
}
