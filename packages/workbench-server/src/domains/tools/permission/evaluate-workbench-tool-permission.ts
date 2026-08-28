import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  AgentRecord,
  PermissionException,
  LegacyPermissionRule,
  LegacyPermissionRuleMatcherKind,
  StaticToolRisk,
  ToolName,
  ToolRisk,
} from "@nervekit/contracts";
import {
  evaluatePermissionRequest,
  evaluateToolPermission,
  evaluateToolSupervision,
  normalizePermissionRequest,
  permissionMetadataForTool,
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
): LegacyPermissionRule {
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
): LegacyPermissionRuleMatcherKind {
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
  if (context.policy && context.roots) {
    try {
      const normalizedRequest = normalizePermissionRequest({
        toolName,
        args,
        normalizedArgs: request.normalizedArgs,
        roots: context.roots,
        cwd: request.cwd,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
      });
      const evaluatedPermission = evaluatePermissionRequest({
        request: normalizedRequest,
        policy: context.policy,
      });
      const permissionEvaluation = context.policyDiagnostic
        ? {
            ...evaluatedPermission,
            reason: `${context.policyDiagnostic} ${evaluatedPermission.reason}`,
          }
        : evaluatedPermission;
      const risk = legacyRisk(permissionEvaluation.baseRisk);
      return {
        decision:
          permissionEvaluation.decision === "prompt"
            ? "approval"
            : permissionEvaluation.decision,
        risk,
        reason: permissionEvaluation.reason,
        normalizedArgs: normalizedRequest.args,
        cwd: request.cwd,
        suggestedExceptions: [],
        permissionEvaluation,
        supervision: {
          version: 1,
          decision: permissionEvaluation.decision,
          effectiveRisk: risk,
          reason: permissionEvaluation.reason,
          normalizedArgs: normalizedRequest.args,
          normalizedTargets: permissionEvaluation.normalizedTargets.map(
            (target) =>
              target.kind === "path"
                ? {
                    kind: "path" as const,
                    access: target.access,
                    scope: target.scope,
                    absolutePath:
                      "root" in target
                        ? resolve(
                            context.roots![target.root],
                            target.relativePath,
                          )
                        : target.absolutePath,
                    ...("root" in target && target.root === "project"
                      ? { projectRelativePath: target.relativePath }
                      : {}),
                  }
                : target.kind === "url"
                  ? { kind: "url" as const, url: target.normalizedUrl }
                  : { kind: "whole_tool" as const },
          ),
          matchedRuleIds: [`rule_${permissionEvaluation.winningRuleId}`],
          policySnapshotHash: permissionEvaluation.policySnapshotHash,
          suggestedRules: [],
        },
      };
    } catch (error) {
      const reason = `Permission request validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      const risk = legacyRisk(permissionMetadataForTool(toolName).baseRisk);
      return {
        decision: "deny",
        risk,
        reason,
        normalizedArgs: request.normalizedArgs,
        cwd: request.cwd,
        suggestedExceptions: [],
        supervision: {
          version: 1,
          decision: "deny",
          effectiveRisk: risk,
          reason,
          normalizedArgs: request.normalizedArgs,
          normalizedTargets: [],
          matchedRuleIds: [],
          policySnapshotHash: `sha256:${createHash("sha256")
            .update(reason)
            .digest("hex")}`,
          suggestedRules: [],
        },
      };
    }
  }
  let normalizedArgs = request.normalizedArgs;
  let denial: string | undefined;
  let allowWithoutApproval = false;

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
    allowWithoutApproval = guardrails.allowWithoutApproval ?? false;
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
  const autoAllowPlanWrite =
    agent.mode === "planning" &&
    allowWithoutApproval &&
    evaluated.decision === "approval" &&
    supervision.decision === "prompt";
  const planningDecision =
    agent.mode === "planning"
      ? autoAllowPlanWrite
        ? "allow"
        : evaluated.decision === "approval"
          ? "prompt"
          : evaluated.decision
      : supervision.decision;
  const durableSupervision =
    supervision.decision === "deny" || planningDecision === supervision.decision
      ? supervision
      : {
          ...supervision,
          decision: planningDecision,
          effectiveRisk: evaluated.risk,
          reason: autoAllowPlanWrite
            ? "Planning mode allows plan files to be saved without separate approval."
            : evaluated.reason,
          normalizedArgs: evaluated.normalizedArgs,
          ...(autoAllowPlanWrite
            ? { matchedRuleIds: [], suggestedRules: [] }
            : {}),
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
    suggestedExceptions: autoAllowPlanWrite
      ? []
      : evaluated.suggestedExceptions,
    supervision: durableSupervision,
  };
}

function legacyRisk(risk: StaticToolRisk): ToolRisk {
  if (risk === "write") return "workspace_write";
  if (risk === "unknown") return "command";
  return risk;
}
