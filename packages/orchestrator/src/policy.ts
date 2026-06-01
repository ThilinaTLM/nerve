import { resolve, sep } from "node:path";
import type { AgentRecord, ToolName, ToolRisk } from "@nerve/shared";
import {
  hasDangerousCommandPattern,
  isKnownReadOnlyCommand,
  isLikelyLongRunningCommand,
  resolveToolPath,
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
  context: PolicyContext,
): PolicyEvaluation {
  const cwd = normalizeCwd(agent, args);
  const normalizedArgs = { ...args };
  let risk = classifyRisk(toolName, args, agent, context);

  const boundary = enforceBoundaries(
    agent,
    toolName,
    normalizedArgs,
    cwd,
    context,
  );
  if (boundary)
    return { decision: "deny", risk, reason: boundary, normalizedArgs, cwd };

  if (toolName === "bash" && typeof args.command === "string") {
    if (isLikelyLongRunningCommand(args.command)) {
      return {
        decision: "deny",
        risk: "command",
        reason:
          "Long-running commands must use process_start so logs and lifecycle are supervised.",
        normalizedArgs,
        cwd,
      };
    }
    if (hasDangerousCommandPattern(args.command)) risk = "destructive";
    else if (isKnownReadOnlyCommand(args.command)) risk = "read";
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

  if (agent.mode === "planning") {
    if (risk === "plan_write") {
      return agent.permissionLevel === "autonomous"
        ? {
            decision: "allow",
            risk,
            reason: "Planning mode may write to the plan sandbox autonomously.",
            normalizedArgs,
            cwd,
          }
        : {
            decision: "approval",
            risk,
            reason:
              "Planning mode plan-sandbox writes require user approval for supervised agents.",
            normalizedArgs,
            cwd,
          };
    }
    return {
      decision: "deny",
      risk,
      reason: `Planning mode forbids '${risk}' tool calls outside the plan sandbox.`,
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

  if (risk === "destructive") {
    return {
      decision: "approval",
      risk,
      reason:
        "Destructive commands require explicit approval even in autonomous mode.",
      normalizedArgs,
      cwd,
    };
  }

  return {
    decision: "allow",
    risk,
    reason: `Autonomous coding agent may run '${risk}' tool calls within scope.`,
    normalizedArgs,
    cwd,
  };
}

export function planSandboxRoot(dataDir: string): string {
  return resolve(dataDir, "plans");
}

export function isInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
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
  agent: AgentRecord,
  context: PolicyContext,
): ToolRisk {
  if (toolName === "process_list" || toolName === "process_logs") return "read";
  if (toolName === "process_stop" || toolName === "process_restart") {
    return "destructive";
  }
  if (
    (toolName === "write" || toolName === "edit") &&
    typeof args.path === "string"
  ) {
    const target = resolveToolPath(agent.projectDir, args.path);
    return isInside(planSandboxRoot(context.dataDir), target)
      ? "plan_write"
      : "workspace_write";
  }
  return toolRiskForName(toolName);
}

function enforceBoundaries(
  agent: AgentRecord,
  toolName: ToolName,
  args: Record<string, unknown>,
  cwd: string,
  context: PolicyContext,
): string | undefined {
  const workspaceRoots = agent.workspaceScope.roots.map((root) =>
    resolve(root),
  );
  const planRoot = planSandboxRoot(context.dataDir);
  const isInWorkspace = (path: string) =>
    workspaceRoots.some((root) => isInside(root, path));
  const isInPlanSandbox = (path: string) => isInside(planRoot, path);

  if (
    (toolName === "bash" || toolName === "process_start") &&
    !isInWorkspace(cwd)
  ) {
    return "Shell commands must run inside the agent workspace scope.";
  }

  if (["read", "write", "edit", "list", "search"].includes(toolName)) {
    const pathValue = args.path ?? ".";
    if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
      return "Filesystem tools require a non-empty path.";
    }
    const target = resolveToolPath(agent.projectDir, pathValue);
    if (!isInWorkspace(target) && !isInPlanSandbox(target)) {
      return "Filesystem path is outside the agent workspace scope and plan sandbox.";
    }
  }

  return undefined;
}
