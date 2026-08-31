import { resolve } from "node:path";
import type { StaticToolRisk, ToolRisk } from "@nervekit/contracts/permissions";
import type { ToolName } from "@nervekit/contracts/tools";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "../policy/permission-policy.js";
import { permissionMetadataForTool } from "../catalog/permission-metadata.js";
import type { RuntimeToolPermissionInput, ToolDecision } from "./types.js";

export function evaluateRuntimeToolPermission(
  name: ToolName,
  args: Record<string, unknown>,
  input: RuntimeToolPermissionInput,
): ToolDecision {
  const project = resolve(input.projectDir ?? process.cwd());
  const nerveHome = resolve(
    input.nerveHome ?? process.env.NERVE_HOME ?? project,
  );
  let request;
  try {
    request = normalizePermissionRequest({
      toolName: name,
      args,
      roots: {
        project,
        nerve_home: nerveHome,
        nerve_data: resolve(nerveHome, "data"),
        plans: resolve(nerveHome, "data", "plans"),
      },
      cwd: input.cwd ?? project,
      conversationId: input.conversationId ?? "runtime",
    });
  } catch (error) {
    const baseRisk = permissionMetadataForTool(name).baseRisk;
    return {
      decision: "deny",
      risk: legacyRisk(baseRisk),
      reason: `Permission request validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      normalizedArgs: { ...args },
    };
  }
  const selected = builtInPermissionRuleSet(
    input.permissionRuleSetId ?? input.permissionLevel,
  );
  const evaluated = evaluatePermissionRequest({
    request,
    policy: composeEffectivePermissionPolicy({ selectedRuleSet: selected }),
  });
  const risk = legacyRisk(evaluated.baseRisk);
  let decision: ToolDecision["decision"] =
    evaluated.decision === "prompt" ? "approval" : evaluated.decision;
  let { reason } = evaluated;

  if (input.groupRequireApproval === "always" && decision !== "deny") {
    decision = "approval";
    reason = "The tool group requires approval.";
  } else if (
    input.groupRequireApproval === "risky" &&
    ["destructive", "secret", "deployment", "agent_spawn"].includes(
      evaluated.baseRisk,
    ) &&
    decision === "allow"
  ) {
    decision = "approval";
    reason = "The tool group requires approval for risky operations.";
  }

  return { decision, risk, reason, normalizedArgs: request.args };
}

function legacyRisk(risk: StaticToolRisk): ToolRisk {
  if (risk === "write") return "workspace_write";
  if (risk === "unknown") return "command";
  return risk;
}
