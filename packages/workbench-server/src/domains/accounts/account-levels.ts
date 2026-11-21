import type { AccountKind } from "@nervekit/contracts/extensions";
import type { AccountLevel } from "@nervekit/contracts/settings";

/**
 * An account kind as a composition defines it. Kinds of built-in and user extensions are available
 * everywhere; a kind a project (repository) extension defines belongs to that project only.
 */
export type AccountDefinition = {
  kind: AccountKind;
  /** Set for a kind a project's own extension defines. */
  projectId?: string;
};

export const levelOf = (row: { projectId: string | null }): AccountLevel =>
  row.projectId === null ? "user" : "project";

/**
 * Whether an account of `definition` may live at `projectId` (null: user level). A project-defined
 * kind has project-level accounts of the defining project only.
 */
export function allowsLevel(
  definition: AccountDefinition,
  projectId: string | null,
): boolean {
  return definition.projectId === undefined
    ? true
    : projectId === definition.projectId;
}

/** The definition an account row uses; undefined when its extension is gone or off. */
export function definitionOf(
  definitions: readonly AccountDefinition[],
  row: { kind: string; projectId: string | null },
): AccountDefinition | undefined {
  return definitions.find(
    (candidate) =>
      candidate.kind.kind === row.kind && allowsLevel(candidate, row.projectId),
  );
}

/**
 * Whether an account is offered to a scope: a project sees user-level accounts and its own; a
 * scope without a project sees user-level ones. An `account` setting saved at user scope selects
 * user-level accounts only (`userLevelOnly`).
 */
export function visibleTo(
  row: { projectId: string | null },
  scope: {
    projectId?: string | undefined;
    userLevelOnly?: boolean | undefined;
  },
): boolean {
  if (row.projectId === null) return true;
  return !scope.userLevelOnly && row.projectId === scope.projectId;
}
