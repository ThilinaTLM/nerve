import type { ToolName } from "@nervekit/contracts";
import { evaluateToolPermission } from "../policy/evaluate-tool-permission.js";
import type { RuntimeToolPermissionInput, ToolDecision } from "./types.js";

export function evaluateRuntimeToolPermission(
  name: ToolName,
  args: Record<string, unknown>,
  input: RuntimeToolPermissionInput,
): ToolDecision {
  const evaluated = evaluateToolPermission({
    toolName: name,
    args,
    permissionLevel: input.permissionLevel,
  });
  const { risk, normalizedArgs } = evaluated;
  let { decision, reason } = evaluated;

  if (input.groupRequireApproval === "always" && decision !== "deny") {
    decision = "approval";
    reason = "The tool group requires approval.";
  } else if (
    input.groupRequireApproval === "risky" &&
    ["destructive", "secret", "deployment", "agent_spawn"].includes(risk) &&
    decision === "allow"
  ) {
    decision = "approval";
    reason = "The tool group requires approval for risky operations.";
  }

  return { decision, risk, reason, normalizedArgs };
}
