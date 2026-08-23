import type {
  Mode,
  PermissionLevel,
  SupervisionGrant,
  ToolName,
  ToolRisk,
} from "@nervekit/contracts";
import type { ShellCommandAssessment } from "../safety/command-analysis.js";

export interface RiskAssessment {
  risk: ToolRisk;
  source: "manifest" | "arguments";
  summary: string;
  command?: ShellCommandAssessment;
}

export interface SupervisionConstraint {
  decision: "deny";
  reason: string;
}

export interface SupervisionInput {
  toolName: ToolName;
  args: Record<string, unknown>;
  agent: {
    permissionLevel: PermissionLevel;
    mode: Mode;
    autoApproveReadOnly: boolean;
  };
  preferences?: {
    grants: readonly SupervisionGrant[];
  };
  constraints?: readonly SupervisionConstraint[];
  normalizedArgs?: Record<string, unknown>;
}

export interface SupervisionDecision {
  decision: "allow" | "approval" | "deny";
  assessment: RiskAssessment;
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
  matchedGrantId?: string;
  suggestedGrants: SupervisionGrant[];
}
