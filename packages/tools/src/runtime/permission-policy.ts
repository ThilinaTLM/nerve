import type { ToolName } from "@nervekit/contracts";
import {
  classifyToolRisk,
  requireToolDefinition,
} from "../catalog/manifest.js";
import type { SharedPermissionInput, ToolDecision } from "./types.js";

export function decideToolPermission(
  name: ToolName,
  args: Record<string, unknown>,
  input: SharedPermissionInput,
): ToolDecision {
  const definition = requireToolDefinition(name);
  const risk = classifyToolRisk(name, args);
  const normalizedArgs = args;
  const readLike = risk === "read" || risk === "interaction";
  const readOnlyNetwork = definition.traits.includes("read_only_network");

  if (input.permissionLevel === "read_only") {
    const denied =
      definition.traits.includes("write_capable") ||
      [
        "command",
        "network",
        "secret",
        "destructive",
        "agent_spawn",
        "deployment",
      ].includes(risk);
    if (denied && !(readOnlyNetwork && input.allowReadOnlyNetwork === true)) {
      return {
        decision: "deny",
        risk,
        reason: `Read-only permission denies '${name}'.`,
        normalizedArgs,
      };
    }
  }

  let decision: ToolDecision["decision"] = "allow";
  let reason = `Permission profile allows '${name}'.`;
  if (
    input.permissionLevel === "supervised" &&
    !readLike &&
    !(readOnlyNetwork && input.approvalPolicy.autoApproveReadOnly)
  ) {
    decision = "approval";
    reason = `Supervised permission requires approval for ${risk} risk.`;
  }
  if (
    readLike &&
    !input.approvalPolicy.autoApproveReadOnly &&
    input.permissionLevel !== "autonomous"
  ) {
    decision = "approval";
    reason = "Read-only auto-approval is disabled.";
  }

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
