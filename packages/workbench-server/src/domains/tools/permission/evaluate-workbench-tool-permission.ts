import type { AgentRecord, ToolName } from "@nervekit/contracts";
import { evaluateToolPermission } from "@nervekit/tools";
import { planningModeGuardrails } from "./planning-mode-guardrails.js";
import { toolRequestContext } from "./tool-request-context.js";
import type {
  WorkbenchPermissionContext,
  WorkbenchPermissionEvaluation,
} from "./types.js";

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
  return {
    decision: evaluated.decision,
    risk: evaluated.risk,
    reason: evaluated.reason,
    normalizedArgs: evaluated.normalizedArgs,
    cwd: request.cwd,
    suggestedExceptions: evaluated.suggestedExceptions,
  };
}
