import { basename } from "node:path";
import type { Diagnostic } from "@nervekit/contracts/configuration";
import type {
  PermissionRule,
  ValueMatcher,
} from "@nervekit/contracts/permissions";
import type {
  ParsedPermissionFile,
  PermissionFileIdentity,
} from "./permission-files.js";

/** What a permission file is compared against to find mistakes that load cleanly. */
export type PermissionWarningContext = {
  /** Every tool name a rule can match: core, built-in and loaded extension tools. */
  toolNames: ReadonlySet<string>;
  /** Built-in and user rule set ids. */
  ruleSetIds: ReadonlySet<string>;
  builtinRuleSetIds: ReadonlySet<string>;
};

/** Tools whose primary argument is a command line or a program. */
const COMMAND_TOOLS = ["bash", "python_exec"];

const warning = (
  code: string,
  message: string,
  pointer: string,
): Diagnostic => ({ level: "warning", code, message, pointer });

function matchesEverything(matcher: ValueMatcher | undefined): boolean {
  return (
    matcher === undefined ||
    (matcher.operator === "glob" && /^\*+$/.test(matcher.value))
  );
}

function ruleWarnings(
  rule: PermissionRule,
  pointer: string,
  context: PermissionWarningContext,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const lowered = new Map(
    [...context.toolNames].map((name) => [name.toLowerCase(), name]),
  );
  for (const [index, name] of (rule.when.toolNames ?? []).entries()) {
    if (context.toolNames.has(name)) continue;
    const near = lowered.get(name.toLowerCase());
    found.push(
      warning(
        "unknown-tool-name",
        near
          ? `Rule "${rule.id}" names the tool "${name}", which does not exist; rules match names exactly. Use "${near}".`
          : `Rule "${rule.id}" names the tool "${name}", which no core tool or loaded extension provides, so the rule never matches. Correct the name, or ignore this if an extension that is switched off provides it.`,
        `${pointer}/when/toolNames/${index}`,
      ),
    );
  }
  const filter = rule.when;
  const command = COMMAND_TOOLS.find((name) =>
    filter.toolNames?.includes(name),
  );
  if (
    command &&
    rule.enabled &&
    rule.decision === "allow" &&
    matchesEverything(filter.primaryArgument) &&
    filter.arguments === undefined &&
    filter.baseRisks === undefined &&
    filter.targets === undefined &&
    filter.primaryTarget === undefined
  )
    found.push(
      warning(
        "unbounded-allow",
        `Rule "${rule.id}" allows every ${command} call, which can run anything. Bound it with \`primaryArgument\` (prefer \`equals\` or \`in\`) or \`baseRisks\`, unless that is what the user asked for.`,
        `${pointer}/when`,
      ),
    );
  return found;
}

/** Warnings of a file that parsed: it loads, and probably does not do what was meant. */
export function permissionFileWarnings(
  path: string,
  identity: PermissionFileIdentity,
  parsed: Extract<ParsedPermissionFile, { ok: true }>,
  context: PermissionWarningContext,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const ruleSet = parsed.ruleSet;
  if (ruleSet) {
    const fileId = basename(path, ".json");
    if (ruleSet.id !== fileId)
      found.push(
        warning(
          "rule-set-id-mismatch",
          `The file is named "${fileId}.json" and its id is "${ruleSet.id}". Make them equal; profiles and overlays select the rule set by id.`,
          "/id",
        ),
      );
    if (context.builtinRuleSetIds.has(ruleSet.id))
      found.push(
        warning(
          "rule-set-shadows-builtin",
          `"${ruleSet.id}" is a built-in rule set, and the built-in wins, so this file is never used. Choose another id and file name.`,
          "/id",
        ),
      );
    for (const [index, rule] of ruleSet.rules.entries())
      found.push(...ruleWarnings(rule, `/rules/${index}`, context));
  }
  for (const [index, overlay] of (parsed.overlay?.overlays ?? []).entries()) {
    if (!context.ruleSetIds.has(overlay.ruleSetId))
      found.push(
        warning(
          "unknown-rule-set",
          `No rule set has the id "${overlay.ruleSetId}", so these rules never apply. Available: ${[...context.ruleSetIds].sort().join(", ")}.`,
          `/overlays/${index}/ruleSetId`,
        ),
      );
    for (const [ruleIndex, rule] of overlay.rules.entries())
      found.push(
        ...ruleWarnings(rule, `/overlays/${index}/rules/${ruleIndex}`, context),
      );
  }
  return found;
}
