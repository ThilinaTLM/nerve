import { requireToolDefinition } from "../catalog/manifest.js";
import {
  coveringAllowExceptions,
  matchingDenyExceptions,
  suggestedPermissionExceptions,
} from "./permission-exceptions.js";
import { permissionTargets } from "./permission-targets.js";
import { assessToolRisk } from "./tool-risk-assessment.js";
import type { ToolPermissionEvaluation, ToolPermissionInput } from "./types.js";

export function evaluateToolPermission(
  input: ToolPermissionInput,
): ToolPermissionEvaluation {
  const normalizedArgs = input.normalizedArgs ?? { ...input.args };
  const assessment = assessToolRisk(input.toolName, normalizedArgs);
  const targets = permissionTargets({
    toolName: input.toolName,
    args: normalizedArgs,
    cwd: input.context?.cwd,
    projectDir: input.context?.projectDir,
    command: assessment.command,
  });
  const base = {
    assessment,
    targets,
    risk: assessment.risk,
    normalizedArgs,
  };
  const constraint = input.constraints?.[0];
  if (constraint) {
    return {
      ...base,
      decision: "deny",
      reason: constraint.reason,
      matchedExceptionIds: [],
      suggestedExceptions: [],
    };
  }

  const exceptions = input.exceptions ?? [];
  const denials = matchingDenyExceptions({
    toolName: input.toolName,
    targets,
    exceptions,
  });
  if (denials.length) {
    return {
      ...base,
      decision: "deny",
      reason: "A permission exception blocks this tool request.",
      matchedExceptionIds: denials.map((exception) => exception.id),
      suggestedExceptions: [],
    };
  }

  const definition = requireToolDefinition(input.toolName);
  const readLike =
    assessment.risk === "read" ||
    (definition.traits.includes("read_only_network") &&
      input.permissionLevel !== "read_only");

  if (input.permissionLevel === "read_only") {
    const allowed =
      assessment.risk === "read" || assessment.risk === "interaction";
    return {
      ...base,
      decision: allowed ? "allow" : "deny",
      reason: allowed
        ? "Read only permits local inspection and user interaction."
        : "Read only blocks commands, network access, and mutations.",
      matchedExceptionIds: [],
      suggestedExceptions: [],
    };
  }

  if (assessment.risk === "interaction") {
    return {
      ...base,
      decision: "allow",
      reason: "User interaction tools are allowed.",
      matchedExceptionIds: [],
      suggestedExceptions: [],
    };
  }

  if (input.permissionLevel === "autonomous") {
    return {
      ...base,
      decision: "allow",
      reason: "Autonomous permission allows this request.",
      matchedExceptionIds: [],
      suggestedExceptions: [],
    };
  }

  if (readLike) {
    return {
      ...base,
      decision: "allow",
      reason: "Supervised permission automatically allows safe reads.",
      matchedExceptionIds: [],
      suggestedExceptions: [],
    };
  }

  const approvals = coveringAllowExceptions({
    toolName: input.toolName,
    risk: assessment.risk,
    targets,
    exceptions,
  });
  if (approvals.length) {
    return {
      ...base,
      decision: "allow",
      reason: "A permission exception allows this supervised request.",
      matchedExceptionIds: approvals.map((exception) => exception.id),
      suggestedExceptions: [],
    };
  }

  return {
    ...base,
    decision: "approval",
    reason: "Supervised permission requires approval for this request.",
    matchedExceptionIds: [],
    suggestedExceptions: suggestedPermissionExceptions({
      toolName: input.toolName,
      assessment,
      targets,
    }),
  };
}
