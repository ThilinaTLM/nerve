/** A visible row of the repository tree, in display order. */
export interface TreeRow {
  readonly id: string;
  readonly kind: "repository" | "branch";
  /** Id of the repository row a branch row belongs to. */
  readonly parent?: string;
  /** Repositories only. */
  readonly expanded?: boolean;
}

export type TreeNavigation =
  | { readonly type: "focus"; readonly id: string }
  | { readonly type: "expand" | "collapse" | "toggle"; readonly id: string }
  | { readonly type: "select"; readonly id: string }
  | undefined;

/**
 * Keyboard model of the tree: Up/Down move between visible rows, Right
 * expands a repository or moves to its first branch, Left collapses or moves
 * to the parent, Enter/Space selects a branch (and toggles a repository),
 * Home/End jump.
 */
export function navigateTree(
  rows: readonly TreeRow[],
  currentId: string | undefined,
  key: string,
): TreeNavigation {
  if (rows.length === 0) return undefined;
  const index = rows.findIndex((row) => row.id === currentId);
  const current = index === -1 ? undefined : rows[index];
  switch (key) {
    case "ArrowDown":
      return {
        type: "focus",
        id: rows[Math.min(index + 1, rows.length - 1)]!.id,
      };
    case "ArrowUp":
      return { type: "focus", id: rows[Math.max(index - 1, 0)]!.id };
    case "Home":
      return { type: "focus", id: rows[0]!.id };
    case "End":
      return { type: "focus", id: rows[rows.length - 1]!.id };
    case "ArrowRight": {
      if (current?.kind !== "repository") return undefined;
      if (!current.expanded) return { type: "expand", id: current.id };
      const first = rows[index + 1];
      return first?.parent === current.id
        ? { type: "focus", id: first.id }
        : undefined;
    }
    case "ArrowLeft": {
      if (!current) return undefined;
      if (current.kind === "repository")
        return current.expanded
          ? { type: "collapse", id: current.id }
          : undefined;
      return current.parent ? { type: "focus", id: current.parent } : undefined;
    }
    case "Enter":
    case " ":
      if (!current) return undefined;
      return current.kind === "branch"
        ? { type: "select", id: current.id }
        : { type: "toggle", id: current.id };
    default:
      return undefined;
  }
}
