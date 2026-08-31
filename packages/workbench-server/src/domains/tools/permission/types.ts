import type {
  PermissionEvaluationResult,
  PermissionException,
  LegacyPermissionRule,
  SupervisionDecision,
  ToolRisk,
} from "@nervekit/contracts/permissions";
import type {
  EffectivePermissionPolicy,
  PermissionRootPaths,
} from "@nervekit/tools/policy";

export interface WorkbenchPermissionContext {
  dataDir: string;
  exceptions?: readonly PermissionException[];
  rules?: readonly LegacyPermissionRule[];
  policy?: EffectivePermissionPolicy;
  roots?: PermissionRootPaths;
  policyDiagnostic?: string;
}

export interface WorkbenchPermissionEvaluation {
  decision: "allow" | "approval" | "deny";
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
  cwd: string;
  suggestedExceptions?: PermissionException[];
  supervision?: SupervisionDecision;
  permissionEvaluation?: PermissionEvaluationResult;
}
