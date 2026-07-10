import type { AgentRecord, Mode, PermissionLevel } from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";

export function assertChildAuthority(
  parent: AgentRecord,
  mode: Mode,
  permissionLevel: PermissionLevel,
  allowAuthorityExceed: boolean,
): void {
  if (parent.budget.depth >= parent.budget.maxDepth) {
    throw new HttpError(
      403,
      "SUBAGENT_DEPTH_LIMIT",
      `Child-agent depth limit reached (${parent.budget.depth}/${parent.budget.maxDepth}).`,
    );
  }
  if (parent.budget.usedRuns >= parent.budget.maxRuns) {
    throw new HttpError(
      403,
      "SUBAGENT_BUDGET_EXHAUSTED",
      `Child-agent run budget exhausted (${parent.budget.usedRuns}/${parent.budget.maxRuns}).`,
    );
  }
  const exceeds =
    modeRank(mode) > modeRank(parent.mode) ||
    permissionRank(permissionLevel) > permissionRank(parent.permissionLevel);
  if (exceeds && !allowAuthorityExceed) {
    throw new HttpError(
      403,
      "SUBAGENT_AUTHORITY_EXCEEDED",
      "Child agent authority cannot exceed parent authority without an approved agent-spawn tool call.",
    );
  }
}

export function modeRank(mode: Mode): number {
  return mode === "planning" ? 0 : 1;
}

export function permissionRank(permission: PermissionLevel): number {
  switch (permission) {
    case "read_only":
      return 0;
    case "supervised":
      return 1;
    case "autonomous":
      return 2;
  }
}
