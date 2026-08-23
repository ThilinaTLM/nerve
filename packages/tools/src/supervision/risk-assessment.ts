import type { ToolName } from "@nervekit/contracts";
import { requireToolDefinition } from "../catalog/manifest.js";
import { analyzeShellCommand } from "../safety/command-analysis.js";
import type { RiskAssessment } from "./types.js";

export function assessToolRisk(
  toolName: ToolName,
  args: Record<string, unknown>,
): RiskAssessment {
  const definition = requireToolDefinition(toolName);
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const assessment = analyzeShellCommand(command);
    return {
      risk: assessment.risk,
      source: "arguments",
      summary: assessment.summary,
      command: assessment,
    };
  }
  const risk = definition.classifyRisk?.(args) ?? definition.baseRisk;
  return {
    risk,
    source: definition.classifyRisk ? "arguments" : "manifest",
    summary: definition.classifyRisk
      ? `Arguments refine '${toolName}' to ${risk} risk.`
      : `The tool manifest classifies '${toolName}' as ${risk} risk.`,
  };
}
