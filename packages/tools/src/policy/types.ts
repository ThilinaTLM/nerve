import type { ToolRisk } from "@nervekit/contracts/permissions";

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
