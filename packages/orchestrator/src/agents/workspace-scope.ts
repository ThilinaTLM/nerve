import { resolve, sep } from "node:path";
import type { AgentRecord } from "@nerve/shared";

export function workspaceScopeArg(
  value: unknown,
): AgentRecord["workspaceScope"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roots = value.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return roots.length > 0 ? { roots } : undefined;
}

export function boundedWorkspaceScope(
  parent: AgentRecord,
  requested: AgentRecord["workspaceScope"],
): AgentRecord["workspaceScope"] {
  const parentRoots = parent.workspaceScope.roots.map((root) => resolve(root));
  const roots = requested.roots.map((root) => resolve(parent.projectDir, root));
  const insideParent = roots.every((root) =>
    parentRoots.some((parentRoot) => isInsidePath(parentRoot, root)),
  );
  if (!insideParent) {
    throw new Error("Subagent workspace roots cannot exceed parent scope.");
  }
  return {
    roots,
    readonly: requested.readonly ?? parent.workspaceScope.readonly,
  };
}

export function isInsidePath(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
}
