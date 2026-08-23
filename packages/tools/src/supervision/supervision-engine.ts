import { requireToolDefinition } from "../catalog/manifest.js";
import { matchingGrant, suggestedGrants } from "./grant-matcher.js";
import { assessToolRisk } from "./risk-assessment.js";
import type { SupervisionDecision, SupervisionInput } from "./types.js";

export function evaluateSupervision(
  input: SupervisionInput,
): SupervisionDecision {
  const assessment = assessToolRisk(input.toolName, input.args);
  const normalizedArgs = input.normalizedArgs ?? input.args;
  const deniedConstraint = input.constraints?.find(
    (constraint) => constraint.decision === "deny",
  );
  if (deniedConstraint) {
    return {
      decision: "deny",
      assessment,
      risk: assessment.risk,
      reason: deniedConstraint.reason,
      normalizedArgs,
      suggestedGrants: [],
    };
  }

  if (assessment.risk === "interaction") {
    return {
      decision: "allow",
      assessment,
      risk: assessment.risk,
      reason: "User-interaction tool calls are allowed.",
      normalizedArgs,
      suggestedGrants: [],
    };
  }

  if (input.agent.permissionLevel === "read_only") {
    const decision = assessment.risk === "read" ? "allow" : "deny";
    return {
      decision,
      assessment,
      risk: assessment.risk,
      reason:
        decision === "allow"
          ? "Read-only permission allows this read operation."
          : `Read-only permission denies ${assessment.risk} risk.`,
      normalizedArgs,
      suggestedGrants: [],
    };
  }

  if (input.agent.permissionLevel === "autonomous") {
    return {
      decision: "allow",
      assessment,
      risk: assessment.risk,
      reason: `Autonomous permission allows ${assessment.risk} risk after hard constraints.`,
      normalizedArgs,
      suggestedGrants: [],
    };
  }

  const definition = requireToolDefinition(input.toolName);
  const readLike =
    assessment.risk === "read" ||
    definition.traits.includes("read_only_network");
  if (readLike && input.agent.autoApproveReadOnly) {
    return {
      decision: "allow",
      assessment,
      risk: assessment.risk,
      reason: "Supervised permission auto-approves read-only tools.",
      normalizedArgs,
      suggestedGrants: [],
    };
  }

  const grant = matchingGrant(
    input.toolName,
    assessment,
    input.preferences?.grants ?? [],
  );
  if (grant) {
    return {
      decision: "allow",
      assessment,
      risk: assessment.risk,
      reason: `Supervised permission matched always-allow grant '${grant.id}'.`,
      normalizedArgs,
      matchedGrantId: grant.id,
      suggestedGrants: [],
    };
  }

  return {
    decision: "approval",
    assessment,
    risk: assessment.risk,
    reason: readLike
      ? "Supervised permission requires approval because auto-approve read-only tools is disabled."
      : `Supervised permission requires approval for ${assessment.risk} risk.`,
    normalizedArgs,
    suggestedGrants: suggestedGrants(input.toolName, assessment),
  };
}
