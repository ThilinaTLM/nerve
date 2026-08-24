import type {
  PermissionException,
  PermissionLevel,
  ToolName,
  ToolRisk,
} from "@nervekit/contracts";

export interface ShellCommandSegmentAssessment {
  tokens: string[];
  normalizedTokens: string[];
  risk: "read" | "command";
  reason: string;
}

export interface ShellCommandAssessment {
  risk: Extract<ToolRisk, "read" | "command" | "destructive">;
  summary: string;
  segments: ShellCommandSegmentAssessment[];
  supported: boolean;
}

export type PermissionTarget =
  | {
      kind: "path";
      access: "read" | "write";
      scope: "exact" | "tree";
      absolutePath: string;
      projectRelativePath?: string;
    }
  | {
      kind: "web_url";
      url: string;
    }
  | {
      kind: "command_segment";
      normalizedTokens: string[];
      risk: "read" | "command";
    };

export interface ToolRiskAssessment {
  risk: ToolRisk;
  source: "manifest" | "arguments";
  summary: string;
  command?: ShellCommandAssessment;
}

export interface ToolPolicyConstraint {
  decision: "deny";
  reason: string;
}

export interface ToolPermissionInput {
  toolName: ToolName;
  args: Record<string, unknown>;
  permissionLevel: PermissionLevel;
  context?: {
    cwd?: string;
    projectDir?: string;
  };
  exceptions?: readonly PermissionException[];
  constraints?: readonly ToolPolicyConstraint[];
  normalizedArgs?: Record<string, unknown>;
}

export interface ToolPermissionEvaluation {
  decision: "allow" | "approval" | "deny";
  assessment: ToolRiskAssessment;
  targets: PermissionTarget[];
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
  matchedExceptionIds: string[];
  suggestedExceptions: PermissionException[];
}
