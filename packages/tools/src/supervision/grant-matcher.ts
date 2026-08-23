import { createHash } from "node:crypto";
import type { SupervisionGrant, ToolName, ToolRisk } from "@nervekit/contracts";
import {
  commandPrefixMatches,
  suggestedCommandPrefix,
} from "../safety/command-analysis.js";
import type { RiskAssessment } from "./types.js";

function grantId(value: unknown): string {
  return `grant_${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24)}`;
}

export function matchingGrant(
  toolName: ToolName,
  assessment: RiskAssessment,
  grants: readonly SupervisionGrant[],
): SupervisionGrant | undefined {
  if (toolName !== "bash") {
    return grants.find(
      (grant) =>
        grant.target === "tool" &&
        grant.toolName === toolName &&
        grant.risk === assessment.risk,
    );
  }
  if (assessment.risk !== "command" || !assessment.command?.supported) {
    return undefined;
  }
  const commandGrants = grants.filter(
    (grant): grant is Extract<SupervisionGrant, { target: "command_prefix" }> =>
      grant.target === "command_prefix" && grant.risk === "command",
  );
  const commandSegments = assessment.command.segments.filter(
    (segment) => segment.risk !== "read",
  );
  if (commandSegments.length === 0) return undefined;
  const matches = commandSegments.map(
    (segment) =>
      commandGrants
        .filter((grant) =>
          commandPrefixMatches(segment.normalizedTokens, grant.tokens),
        )
        .sort((left, right) => right.tokens.length - left.tokens.length)[0],
  );
  return matches.every(Boolean) ? matches[0] : undefined;
}

export function suggestedGrants(
  toolName: ToolName,
  assessment: RiskAssessment,
): SupervisionGrant[] {
  if (["destructive", "secret", "deployment"].includes(assessment.risk)) {
    return [];
  }
  if (toolName === "bash") {
    if (assessment.risk !== "command" || !assessment.command?.supported) {
      return [];
    }
    const prefixes = assessment.command.segments
      .filter((segment) => segment.risk !== "read")
      .map((segment) => suggestedCommandPrefix(segment.normalizedTokens))
      .filter((tokens) => tokens.length > 0);
    const unique = new Map(
      prefixes.map((tokens) => [JSON.stringify(tokens), tokens]),
    );
    return [...unique.values()].map((tokens) => ({
      id: grantId({ target: "command_prefix", tokens, risk: "command" }),
      target: "command_prefix" as const,
      tokens,
      risk: "command" as const,
    }));
  }
  const risk = assessment.risk as ToolRisk;
  const value = { target: "tool", toolName, risk } as const;
  return [{ id: grantId(value), ...value }];
}
