export type ReferenceSelectionScope = {
  document: unknown;
  source: unknown;
  query: string;
  at: number;
};
export type ReferenceSelectionCandidate = { id?: string; eligible: boolean };
type Choice = { scope: ReferenceSelectionScope; id: string };
const sameScope = (a: ReferenceSelectionScope, b: ReferenceSelectionScope) =>
  a.document === b.document &&
  a.source === b.source &&
  a.query === b.query &&
  a.at === b.at;

/** Only an explicit entity choice survives a deliberate same-query refresh.
 * New queries, arbitrary closes, scope changes and ineligible/deleted rows reset. */
export class ComposerReferenceSelection {
  private explicit?: Choice;
  private pending?: Choice;

  remember(
    scope: ReferenceSelectionScope,
    candidate?: ReferenceSelectionCandidate,
  ): void {
    this.explicit =
      candidate?.id && candidate.eligible
        ? { scope, id: candidate.id }
        : undefined;
  }
  prepareRefresh(
    scope: ReferenceSelectionScope,
    selected?: ReferenceSelectionCandidate,
  ): void {
    // A second change notice can arrive while the refreshed list is pending.
    if (!selected && this.pending && sameScope(this.pending.scope, scope))
      return;
    this.pending =
      this.explicit &&
      sameScope(this.explicit.scope, scope) &&
      selected?.eligible &&
      selected.id === this.explicit.id
        ? this.explicit
        : undefined;
    this.explicit = undefined;
  }
  resolve(
    scope: ReferenceSelectionScope | undefined,
    candidates: readonly ReferenceSelectionCandidate[],
  ): number {
    const pending = this.pending;
    this.pending = undefined;
    const index =
      pending && scope && sameScope(pending.scope, scope)
        ? candidates.findIndex(
            (candidate) => candidate.id === pending.id && candidate.eligible,
          )
        : -1;
    this.explicit = index >= 0 ? pending : undefined;
    return index >= 0 ? index : 0;
  }
  clear(): void {
    this.explicit = undefined;
    this.pending = undefined;
  }
}
