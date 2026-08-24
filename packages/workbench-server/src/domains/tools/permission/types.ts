import type {
  PermissionException,
  PermissionRule,
  SupervisionDecision,
  ToolRisk,
} from "@nervekit/contracts";

export interface WorkbenchPermissionContext {
  dataDir: string;
  exceptions?: readonly PermissionException[];
  rules?: readonly PermissionRule[];
}

export interface WorkbenchPermissionEvaluation {
  decision: "allow" | "approval" | "deny";
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
  cwd: string;
  suggestedExceptions?: PermissionException[];
  supervision?: SupervisionDecision;
}
