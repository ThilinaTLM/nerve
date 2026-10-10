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
      risk: toolRisk(baseRisk),
      reason: `Permission request validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      normalizedArgs: { ...args },
    };
  }
  const selected = builtInPermissionRuleSet(input.permissionRuleSetId);
  const evaluated = evaluatePermissionRequest({
    request,
    policy: composeEffectivePermissionPolicy({ selectedRuleSet: selected }),
  });
  const risk = toolRisk(evaluated.baseRisk);
  const decision: ToolDecision["decision"] =
    evaluated.decision === "prompt" ? "approval" : evaluated.decision;
  const { reason } = evaluated;

  return { decision, risk, reason, normalizedArgs: request.args };
}

function toolRisk(risk: StaticToolRisk): ToolRisk {
  if (risk === "write") return "workspace_write";
  if (risk === "unknown") return "command";
  return risk;
}
