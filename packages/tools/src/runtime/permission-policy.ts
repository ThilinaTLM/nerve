import type { ToolName } from "@nervekit/contracts";
import { evaluateSupervision } from "../supervision/supervision-engine.js";
import type { SharedPermissionInput, ToolDecision } from "./types.js";

export function decideToolPermission(
  name: ToolName,
  args: Record<string, unknown>,
  input: SharedPermissionInput,
): ToolDecision {
  const evaluated = evaluateSupervision({
    toolName: name,
    args,
    agent: {
      permissionLevel: input.permissionLevel,
      mode: "coding",
      autoApproveReadOnly: input.approvalPolicy.autoApproveReadOnly,
    },
  });
  const { risk, normalizedArgs } = evaluated;
  let { decision, reason } = evaluated;

  if (input.groupRequireApproval === "always") {
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
