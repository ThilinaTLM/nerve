import { resolve } from "node:path";
import type { AgentRecord, ToolName, ToolRisk } from "@nerve/shared";
import {
  hasDangerousCommandPattern,
  isKnownReadOnlyCommand,
  toolRiskForName,
} from "@nerve/tools";
import {
  isPathInsidePlanDir,
  planDirForStorageHome,
  resolvePlanPath,
} from "./plan-paths.js";

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
  context: PolicyContext,
): PolicyEvaluation {
  const cwd = normalizeCwd(agent, args);
  const normalizedArgs = { ...args };
  const risk = classifyRisk(toolName, args);

  if (agent.mode === "planning") {
    const planningDecision = evaluatePlanningModePolicy(
      agent,
      toolName,
      args,
      risk,
      normalizedArgs,
      cwd,
      context,
    );
    if (planningDecision) return planningDecision;
  }

  if (toolName === "plan_mode_present" || toolName === "plan_mode_force_exit") {
    return {
      decision: "deny",
      risk,
      reason: `${toolName} is only available after entering planning mode.`,
      normalizedArgs,
      cwd,
    };
  }

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

function evaluatePlanningModePolicy(
  agent: AgentRecord,
  toolName: ToolName,
  args: Record<string, unknown>,
  risk: ToolRisk,
  normalizedArgs: Record<string, unknown>,
  cwd: string,
  context: PolicyContext,
): PolicyEvaluation | undefined {
  const allowedInteractionTools = new Set<ToolName>([
    "ask_user",
    "todos_set",
    "plan_mode_enter",
    "plan_mode_present",
    "plan_mode_force_exit",
  ]);
  if (allowedInteractionTools.has(toolName)) {
    return {
      decision: "allow",
      risk,
      reason: "Planning-mode interaction tool call is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  if (risk === "read") {
    return {
      decision: "allow",
      risk,
      reason: "Planning-mode read-only tool call is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  if (toolName === "edit" || toolName === "write") {
    let targetPath: string;
    try {
      targetPath = resolvePlanPath(cwd, args.path);
    } catch (error) {
      return {
        decision: "deny",
        risk,
        reason: error instanceof Error ? error.message : String(error),
        normalizedArgs,
        cwd,
      };
    }
    const planDir = planDirForStorageHome(context.dataDir);
    if (!isPathInsidePlanDir(planDir, targetPath)) {
      return {
        decision: "deny",
        risk,
        reason: `Planning mode allows ${toolName} only for plan files inside ${planDir}. Attempted: ${targetPath}`,
        normalizedArgs,
        cwd,
      };
    }
    normalizedArgs.path = targetPath;
    if (agent.permissionLevel === "read_only") {
      return {
        decision: "deny",
        risk,
        reason: "read_only agents cannot write plan documents.",
        normalizedArgs,
        cwd,
      };
    }
    if (agent.permissionLevel === "supervised") {
      return {
        decision: "approval",
        risk,
        reason:
          "Supervised agent requires approval for plan file write/edit tool calls.",
        normalizedArgs,
        cwd,
      };
    }
    return {
      decision: "allow",
      risk,
      reason: "Planning-mode plan file write/edit tool call is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  if (toolName === "subagent_run") {
    if (args.mode === "coding") {
      return {
        decision: "deny",
        risk,
        reason: "Planning mode cannot spawn coding subagents.",
        normalizedArgs,
        cwd,
      };
    }
    if (agent.permissionLevel === "read_only") {
      return {
        decision: "deny",
        risk,
        reason: "read_only agents cannot spawn subagents.",
        normalizedArgs,
        cwd,
      };
    }
    if (agent.permissionLevel === "supervised") {
      return {
        decision: "approval",
        risk,
        reason: "Supervised agent requires approval for planning subagents.",
        normalizedArgs,
        cwd,
      };
    }
    return {
      decision: "allow",
      risk,
      reason: "Planning-mode subagent investigation is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  return {
    decision: "deny",
    risk,
    reason: `Planning mode cannot run '${toolName}' because it may mutate workspace files, processes, or runtime state outside plan review.`,
    normalizedArgs,
    cwd,
  };
}

function classifyRisk(
  toolName: ToolName,
  args: Record<string, unknown>,
): ToolRisk {
  if (
    toolName === "ask_user" ||
    toolName === "todos_set" ||
    toolName === "plan_mode_enter" ||
    toolName === "plan_mode_present" ||
    toolName === "plan_mode_force_exit"
  ) {
    return "interaction";
  }
  if (
    toolName === "todos_get" ||
    toolName === "process_list" ||
    toolName === "process_logs"
  ) {
    return "read";
  }
  if (toolName === "process_stop" || toolName === "process_restart") {
    return "destructive";
  }
  if (toolName === "bash" && typeof args.command === "string") {
    if (hasDangerousCommandPattern(args.command)) return "destructive";
    if (isKnownReadOnlyCommand(args.command)) return "read";
  }
  return toolRiskForName(toolName);
}
