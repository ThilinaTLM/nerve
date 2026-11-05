import { packageBoundariesRule } from "./package-boundary-checks.ts";
import { exportSurfacesRule } from "./package-export-surfaces.ts";
import { contractsSourceRule } from "./contracts-source-policy.ts";
import type { PolicyRule } from "./policy.ts";
import { retiredSurfacesRule } from "./retired-surface-checks.ts";
import { serverTestRuntimeRule } from "./server-test-runtime-policy.ts";
import { sourceNamingRule } from "./source-naming-policy.ts";
import { uiStyleRule } from "./ui-style-checks.ts";
import { workbenchLayersRule } from "./workbench-boundary-checks.ts";

/** Every repository policy, in reporting order. Add a rule here and nowhere else. */
export const policyRules: readonly PolicyRule[] = [
  packageBoundariesRule,
  workbenchLayersRule,
  uiStyleRule,
  retiredSurfacesRule,
  exportSurfacesRule,
  contractsSourceRule,
  serverTestRuntimeRule,
  sourceNamingRule,
];
