import type {
  AgentRecord,
  PermissionException,
  PermissionRule,
  PermissionRuleMatcherKind,
  ToolName,
} from "@nervekit/contracts";
import {
  evaluateToolPermission,
  evaluateToolSupervision,
} from "@nervekit/tools";
import { planningModeGuardrails } from "./planning-mode-guardrails.js";
import { toolRequestContext } from "./tool-request-context.js";
import type {
  WorkbenchPermissionContext,
  WorkbenchPermissionEvaluation,
} from "./types.js";

function legacyRule(
  exception: PermissionException,
  projectId: string,
  timestamp: string,
): PermissionRule {
  return {
    id: `rule_${exception.id.replace(/^exception_/, "").slice(0, 96)}`,
    scope: "project",
    projectId,
    effect: exception.effect,
    toolName: exception.tool,
    matcherKind: legacyMatcherKind(exception),
    pattern: exception.rule,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function legacyMatcherKind(
  exception: PermissionException,
): PermissionRuleMatcherKind {
  if (["read", "edit", "write", "grep", "find", "ls"].includes(exception.tool))
    return "path_glob";
  if (exception.tool === "bash") return "command_glob";
  if (exception.tool === "web_fetch") return "url_glob";
  return "whole_tool";
}

export function evaluateWorkbenchToolPermission(
  agent: AgentRecord,
  toolName: ToolName,
  args: Record<string, unknown>,
  context: WorkbenchPermissionContext,
): WorkbenchPermissionEvaluation {
  const request = toolRequestContext(agent, args);
  let normalizedArgs = request.normalizedArgs;
  let denial: string | undefined;

  if (agent.mode === "planning") {
    const guardrails = planningModeGuardrails({
      toolName,
      args,
      normalizedArgs,
      cwd: request.cwd,
      dataDir: context.dataDir,
    });
    normalizedArgs = guardrails.normalizedArgs;
    denial = guardrails.denial;
  } else if (
    toolName === "plan_mode_present" ||
    toolName === "plan_mode_force_exit"
  ) {
    denial = `${toolName} is only available after entering planning mode.`;
  }

  const evaluated = evaluateToolPermission({
    toolName,
    args,
    normalizedArgs,
    permissionLevel: agent.permissionLevel,
    context: { cwd: request.cwd, projectDir: agent.projectDir },
    exceptions: context.exceptions,
    ...(denial ? { constraints: [{ decision: "deny", reason: denial }] } : {}),
  });
  const evaluatedAt = new Date().toISOString();
  const supervision = evaluateToolSupervision({
    toolName,
    args,
    normalizedArgs,
    mode: agent.mode,
    permissionLevel: agent.permissionLevel,
    projectId: agent.projectId,
    projectDir: agent.projectDir,
    cwd: request.cwd,
    rules:
      context.rules ??
      (context.exceptions ?? []).map((exception) =>
        legacyRule(exception, agent.projectId, evaluatedAt),
      ),
    constraints: denial ? [{ decision: "deny", reason: denial }] : undefined,
    evaluatedAt,
  });
  const planningDecision =
    agent.mode === "planning"
      ? evaluated.decision === "approval"
        ? "prompt"
        : evaluated.decision
      : supervision.decision;
  const durableSupervision =
    planningDecision === supervision.decision
      ? supervision
      : {
          ...supervision,
          decision: planningDecision,
          effectiveRisk: evaluated.risk,
          reason: evaluated.reason,
          normalizedArgs: evaluated.normalizedArgs,
        };
  return {
    decision:
      durableSupervision.decision === "prompt"
        ? "approval"
        : durableSupervision.decision,
    risk: durableSupervision.effectiveRisk,
    reason: durableSupervision.reason,
    normalizedArgs: durableSupervision.normalizedArgs,
    cwd: request.cwd,
    suggestedExceptions: evaluated.suggestedExceptions,
    supervision: durableSupervision,
  };
}
