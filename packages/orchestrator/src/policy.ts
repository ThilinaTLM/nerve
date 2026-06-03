import { resolve, sep } from "node:path";
import type {
  AgentRecord,
  Mode,
  PermissionLevel,
  ToolName,
  ToolRisk,
} from "@nerve/shared";
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

  if (toolName === "ask_user") {
    return {
      decision: "allow",
      risk: "interaction",
      reason: "User-interaction tool call is allowed.",
      normalizedArgs,
      cwd,
    };
  }

  const boundary = enforceBoundaries(
    agent,
    toolName,
    normalizedArgs,
    cwd,
    context,
  );
  if (boundary)
    return { decision: "deny", risk, reason: boundary, normalizedArgs, cwd };

  if (toolName === "subagent_run") {
    const childMode = modeArg(args.mode) ?? "planning";
    const childPermission = permissionArg(args.permissionLevel) ?? "read_only";
    const budgetReason = evaluateSubagentBudget(agent);
    if (budgetReason) {
      return {
        decision: "deny",
        risk: "agent_spawn",
        reason: budgetReason,
        normalizedArgs: {
          ...normalizedArgs,
          mode: childMode,
          permissionLevel: childPermission,
        },
        cwd,
      };
    }
    const exceeds = childExceedsParentAuthority(
      agent,
      childMode,
      childPermission,
    );
    if (
      !exceeds &&
      childMode === "planning" &&
      childPermission === "read_only"
    ) {
      return {
        decision: "allow",
        risk: "agent_spawn",
        reason: "Read-only planning subagent is within parent authority.",
        normalizedArgs: {
          ...normalizedArgs,
          mode: childMode,
          permissionLevel: childPermission,
        },
        cwd,
      };
    }
    if (exceeds) {
      return {
        decision: "approval",
        risk: "agent_spawn",
        reason:
          "Requested child-agent authority exceeds the parent and requires user approval.",
        normalizedArgs: {
          ...normalizedArgs,
          mode: childMode,
          permissionLevel: childPermission,
        },
        cwd,
      };
    }
    return agent.permissionLevel === "autonomous"
      ? {
          decision: "allow",
          risk: "agent_spawn",
          reason: "Autonomous parent may spawn a bounded child agent.",
          normalizedArgs: {
            ...normalizedArgs,
            mode: childMode,
            permissionLevel: childPermission,
          },
          cwd,
        }
      : {
          decision: "approval",
          risk: "agent_spawn",
          reason: "Non-default child-agent spawn requires user approval.",
          normalizedArgs: {
            ...normalizedArgs,
            mode: childMode,
            permissionLevel: childPermission,
          },
          cwd,
        };
  }

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
  if (toolName === "subagent_run") return "agent_spawn";
  if (toolName === "ask_user") return "interaction";
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

  if (["read", "write", "edit", "grep", "find", "ls"].includes(toolName)) {
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

function modeArg(value: unknown): Mode | undefined {
  return value === "planning" || value === "coding" ? value : undefined;
}

function permissionArg(value: unknown): PermissionLevel | undefined {
  return value === "read_only" ||
    value === "supervised" ||
    value === "autonomous"
    ? value
    : undefined;
}

function modeRank(mode: Mode): number {
  return mode === "planning" ? 0 : 1;
}

function permissionRank(permission: PermissionLevel): number {
  switch (permission) {
    case "read_only":
      return 0;
    case "supervised":
      return 1;
    case "autonomous":
      return 2;
  }
}

function childExceedsParentAuthority(
  parent: AgentRecord,
  childMode: Mode,
  childPermission: PermissionLevel,
): boolean {
  return (
    modeRank(childMode) > modeRank(parent.mode) ||
    permissionRank(childPermission) > permissionRank(parent.permissionLevel)
  );
}

function evaluateSubagentBudget(agent: AgentRecord): string | undefined {
  if (agent.budget.depth >= agent.budget.maxDepth) {
    return `Child-agent depth limit reached (${agent.budget.depth}/${agent.budget.maxDepth}).`;
  }
  if (agent.budget.usedRuns >= agent.budget.maxRuns) {
    return `Child-agent run budget exhausted (${agent.budget.usedRuns}/${agent.budget.maxRuns}).`;
  }
  return undefined;
}
