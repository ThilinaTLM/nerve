import type { ConfigurationBlockedRequest } from "@nervekit/contracts/core";
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";

type ConfigurationDiagnostic =
  ConfigurationBlockedRequest["diagnostics"][number];

/** The diagnostic code of a file that waits for the user's review. */
const NEEDS_REVIEW_CODE = "needs-review";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const inRuleSets = (path: string) => /[\\/]rule-sets[\\/][^\\/]+$/.test(path);

/**
 * The items a configuration-blocked call waits for: a pending rule set or
 * permissions file, as review targets. Project files need the call's project.
 */
export function blockedReviewTargets(
  diagnostics: readonly ConfigurationDiagnostic[],
  projectId: string | undefined,
): ConfigurationReviewTarget[] {
  const targets: ConfigurationReviewTarget[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== NEEDS_REVIEW_CODE) continue;
    if (diagnostic.scope === "conversation") continue;
    const path = diagnostic.path || diagnostic.document;
    const name = fileName(path);
    const ruleSet = inRuleSets(path);
    const kind = ruleSet ? "rule-set" : "permission-overlay";
    const id = ruleSet ? name.replace(/\.json$/, "") : name;
    if (diagnostic.scope === "user") targets.push({ kind, scope: "user", id });
    else if (projectId) targets.push({ kind, scope: "project", projectId, id });
  }
  return targets;
}
