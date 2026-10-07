import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  parentConfigurationSnapshotSchema,
  type AgentRecord,
  type ParentConfigurationSnapshot,
} from "@nervekit/contracts/agents";
import type { Mode } from "@nervekit/contracts/settings";
import type { PermissionLevel } from "@nervekit/contracts/permissions";
import { ApplicationError } from "../../core/application-error.js";

export function assertChildAuthority(
  parent: AgentRecord,
  mode: Mode,
  permissionLevel: PermissionLevel,
  allowAuthorityExceed: boolean,
): void {
  if (parent.budget.depth >= parent.budget.maxDepth) {
    throw new ApplicationError(
      403,
      "SUBAGENT_DEPTH_LIMIT",
      `Child-agent depth limit reached (${parent.budget.depth}/${parent.budget.maxDepth}).`,
    );
  }
  const exceeds =
    modeRank(mode) > modeRank(parent.mode) ||
    permissionRank(permissionLevel) > permissionRank(parent.permissionLevel);
  if (exceeds && !allowAuthorityExceed) {
    throw new ApplicationError(
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

/** User administration is separate from delegated parent authority. */
export function assertAgentConfigurationAuthority(
  current: AgentRecord,
  updated: AgentRecord,
  parent?: AgentRecord,
): void {
  if (
    current.readOnlyCeiling &&
    (updated.permissionLevel !== "read_only" ||
      updated.permissionRuleSetId !== "read_only" ||
      updated.workspaceScope.readonly === false)
  ) {
    throw new ApplicationError(
      403,
      "AGENT_PRESET_CEILING",
      "The read-only preset ceiling cannot be elevated by configuration.",
    );
  }
  if (current.readOnlyCeiling && !scopeContains(current, updated)) {
    throw new ApplicationError(
      403,
      "AGENT_PRESET_WORKSPACE_CEILING",
      "The read-only preset workspace cannot be expanded or escaped by configuration.",
    );
  }
  if (!parent) return;
  if (
    current.parentAgentId !== parent.id ||
    current.parentGrants?.configure === false
  ) {
    throw new ApplicationError(
      403,
      "AGENT_PARENT_FORBIDDEN",
      "Parent configuration requires a grant for its own child.",
    );
  }
  if (
    permissionRank(updated.permissionLevel) >
      permissionRank(parent.permissionLevel) ||
    modeRank(updated.mode) > modeRank(parent.mode)
  ) {
    throw new ApplicationError(
      403,
      "SUBAGENT_AUTHORITY_EXCEEDED",
      "Delegated configuration cannot exceed parent authority.",
    );
  }
  assertDelegatedRuleSelection(
    parent,
    updated.permissionRuleSetId ?? updated.permissionLevel,
  );
  assertAgentWorkspaceAuthority(parent, updated);
}

export function assertAgentWorkspaceAuthority(
  parent: AgentRecord,
  updated: AgentRecord,
): void {
  if (!scopeContains(parent, updated)) {
    throw new ApplicationError(
      403,
      "SUBAGENT_WORKSPACE_EXCEEDED",
      "Delegated configuration cannot escape the parent workspace.",
    );
  }
  if (parent.workspaceScope.readonly && !updated.workspaceScope.readonly) {
    throw new ApplicationError(
      403,
      "SUBAGENT_AUTHORITY_EXCEEDED",
      "Delegation cannot remove a read-only workspace restriction.",
    );
  }
}

function scopeContains(parent: AgentRecord, child: AgentRecord): boolean {
  return [...child.workspaceScope.roots, child.projectDir].every((path) =>
    parent.workspaceScope.roots.some((root) => {
      const delta = relative(resolve(root), resolve(path));
      return (
        delta === "" ||
        (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
      );
    }),
  );
}

/** Parent controls are grants on the target, never inferred from tool availability. */
export function assertAgentParentOperation(
  target: AgentRecord,
  parent: AgentRecord,
  operation: "prompt" | "configure" | "stop",
): void {
  if (
    target.parentAgentId !== parent.id ||
    target.parentGrants?.[operation] === false
  ) {
    throw new ApplicationError(
      403,
      "AGENT_PARENT_FORBIDDEN",
      "Parent operation requires a target grant for its own child.",
    );
  }
}

/** Ordinary delegation configuration is pinned to the originating tool turn.
 * Identity, budgets, grants and immutable ceilings are always from the live record.
 */
export function resolveDelegatingParent(
  live: AgentRecord | undefined,
  snapshot?: ParentConfigurationSnapshot,
): AgentRecord | undefined {
  if (!snapshot) return live;
  if (!live)
    throw new ApplicationError(
      403,
      "AGENT_PARENT_FORBIDDEN",
      "An originating parent snapshot requires a parent identity.",
    );
  const parsed = parentConfigurationSnapshotSchema.parse(snapshot);
  if (
    parsed.agentId !== live.id ||
    parsed.configurationRevision > (live.configurationRevision ?? 1)
  ) {
    throw new ApplicationError(
      403,
      "AGENT_PARENT_SNAPSHOT_INVALID",
      "Originating parent snapshot must belong to an accepted revision of that parent.",
    );
  }
  if (
    !isAbsolute(parsed.configuration.projectDir) ||
    parsed.configuration.workspaceScope.roots.some((root) => !isAbsolute(root))
  ) {
    throw new ApplicationError(
      403,
      "AGENT_PARENT_SNAPSHOT_INVALID",
      "Originating parent workspace snapshot must use absolute paths.",
    );
  }
  return {
    ...live,
    ...parsed.configuration,
    model: parsed.configuration.model ?? undefined,
    systemPrompt: parsed.configuration.systemPrompt ?? undefined,
    permissionRuleSetId:
      parsed.configuration.permissionRuleSetId ??
      parsed.configuration.permissionLevel,
    configurationRevision: parsed.configurationRevision,
  };
}

export function assertLiveParentDelegation(
  live: AgentRecord,
  child: AgentRecord,
  options: { allowPausedParent?: boolean } = {},
): void {
  // Admission alone may opt in after validating a current durable administrative
  // activation proof. New parent acceptance retains the default pause fence.
  if (live.activationState === "paused" && !options.allowPausedParent) {
    throw new ApplicationError(
      403,
      "AGENT_PARENT_PAUSED",
      "A paused parent cannot dispatch delegated controls.",
    );
  }
  // An ordinary current policy/scope edit is not emergency revocation.
  // The immutable preset ceiling remains independently authoritative.
  if (
    live.readOnlyCeiling &&
    (child.permissionLevel !== "read_only" ||
      child.permissionRuleSetId !== "read_only" ||
      !child.workspaceScope.readonly)
  ) {
    throw new ApplicationError(
      403,
      "AGENT_PRESET_CEILING",
      "The live read-only preset ceiling cannot be elevated by delegation.",
    );
  }
}

/** Custom policy IDs cannot be ranked by a permission-level display value. */
export function assertDelegatedRuleSelection(
  parent: AgentRecord,
  childRuleSetId: string,
): void {
  const parentRuleSetId = parent.permissionRuleSetId ?? parent.permissionLevel;
  if (childRuleSetId === parentRuleSetId || childRuleSetId === "read_only")
    return;
  const builtin = (id: string): PermissionLevel | undefined =>
    id === "read_only" || id === "supervised" || id === "autonomous"
      ? id
      : undefined;
  const parentLevel = builtin(parentRuleSetId);
  const childLevel = builtin(childRuleSetId);
  if (
    parentLevel &&
    childLevel &&
    permissionRank(childLevel) <= permissionRank(parentLevel)
  )
    return;
  throw new ApplicationError(
    403,
    "SUBAGENT_AUTHORITY_EXCEEDED",
    "Delegation cannot select a broader or unrelated permission rule set.",
  );
}
