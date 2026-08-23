import type { PermissionException, ToolRisk } from "@nervekit/contracts";

export interface WorkbenchPermissionContext {
  dataDir: string;
  exceptions?: readonly PermissionException[];
}

export interface WorkbenchPermissionEvaluation {
  decision: "allow" | "approval" | "deny";
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
  cwd: string;
  suggestedExceptions?: PermissionException[];
}
