// Runs every repository policy rule (or one with --rule <id>) over the source inventory.
import { parseCli } from "../cli/args.ts";
import { CliError, defineCli } from "../cli/main.ts";
import { repoRoot } from "../workspace/repo.ts";
import { formatViolation, type PolicyRule, type Violation } from "./policy.ts";
import { policyRules } from "./policy-rules.ts";
import { createRepositorySourceInventory } from "./repository-source-inventory.ts";

/** All violations of `rules`, sorted for stable output. */
export function checkRepositoryPolicies(
  root: string,
  rules: readonly PolicyRule[] = policyRules,
): Violation[] {
  const inventory = createRepositorySourceInventory(root);
  return rules
    .flatMap((rule) => rule.check(inventory))
    .sort((left, right) =>
      formatViolation(left).localeCompare(formatViolation(right)),
    );
}

await defineCli(import.meta.url, (argv) => {
  const options = parseCli(
    "check-package-boundaries.ts",
    {
      rule: { type: "string", description: "Run only the rule with this id" },
      list: { type: "boolean", description: "List rule ids and exit" },
    },
    argv,
  );
  if (options.list) {
    for (const rule of policyRules)
      console.log(`${rule.id}\t${rule.description}`);
    return;
  }
  const rules = options.rule
    ? policyRules.filter((rule) => rule.id === options.rule)
    : policyRules;
  if (!rules.length)
    throw new CliError(
      `Unknown rule: ${options.rule}. Rules: ${policyRules.map((rule) => rule.id).join(", ")}`,
    );
  const violations = checkRepositoryPolicies(repoRoot, rules);
  if (violations.length > 0) {
    // Grouped by rule so the failing policy is obvious.
    const lines = ["Package boundary check failed:"];
    for (const rule of rules) {
      const own = violations.filter((violation) => violation.rule === rule.id);
      if (!own.length) continue;
      lines.push(`[${rule.id}] ${rule.description}`);
      for (const violation of own)
        lines.push(`- ${formatViolation(violation)}`);
    }
    throw new CliError(lines.join("\n"));
  }
});
