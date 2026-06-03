import { resolve } from "node:path";
import type { AgentRecord, ToolName, ToolRisk } from "@nerve/shared";
import {
  hasDangerousCommandPattern,
  isKnownReadOnlyCommand,
  toolRiskForName,
} from "@nerve/tools";

export type PolicyDecision = "allow" | "approval" | "deny";

export interface PolicyEvaluation {
  decision: PolicyDecision;
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
  cwd: string;
}

export interface PolicyContext {
  dataDir: string;
}

export function evaluateToolPolicy(
  agent: AgentRecord,
  toolName: ToolName,
  args: Record<string, unknown>,
  _context: PolicyContext,
): PolicyEvaluation {
  const cwd = normalizeCwd(agent, args);
  const normalizedArgs = { ...args };
  const risk = classifyRisk(toolName, args);

  if (risk === "interaction") {
    return {
      decision: "allow",
      risk,
      reason: "User-interaction tool call is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  if (risk === "read") {
    return {
      decision: "allow",
      risk,
      reason: "Read-only tool call is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  if (agent.permissionLevel === "read_only") {
    return {
      decision: "deny",
      risk,
      reason: `Tool risk '${risk}' is not allowed for read_only agents.`,
      normalizedArgs,
      cwd,
    };
  }

  if (agent.permissionLevel === "supervised") {
    return {
      decision: "approval",
      risk,
      reason: `Supervised agent requires approval for '${risk}' tool calls.`,
      normalizedArgs,
      cwd,
    };
  }

  return {
    decision: "allow",
    risk,
    reason: `Autonomous agent may run '${risk}' tool calls without approval.`,
    normalizedArgs,
    cwd,
  };
}

function normalizeCwd(
  agent: AgentRecord,
  args: Record<string, unknown>,
): string {
  const cwd =
    typeof args.cwd === "string" && args.cwd.trim().length > 0
      ? resolve(agent.projectDir, args.cwd)
      : resolve(agent.projectDir);
  return cwd;
}

function classifyRisk(
  toolName: ToolName,
  args: Record<string, unknown>,
): ToolRisk {
  if (toolName === "ask_user") return "interaction";
  if (toolName === "process_list" || toolName === "process_logs") return "read";
  if (toolName === "process_stop" || toolName === "process_restart") {
    return "destructive";
  }
  if (toolName === "bash" && typeof args.command === "string") {
    if (hasDangerousCommandPattern(args.command)) return "destructive";
    if (isKnownReadOnlyCommand(args.command)) return "read";
  }
  return toolRiskForName(toolName);
}
