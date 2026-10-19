import {
  completionGroupKinds,
  type CompletionGroup,
  type CompletionItem,
} from "@nervekit/contracts/completions";

export type CompletionContext = {
  /** Project-relative paths only; supplied by the authorized current conversation. */
  referencedPaths?: readonly string[];
  editedPaths?: readonly string[];
  openPaths?: readonly string[];
};

/** Collision-free across kinds, even when source identities contain delimiters. */
export function completionUsageId(kind: string, sourceId: string): string {
  return JSON.stringify([kind, sourceId]);
}

export type CompletionRankCandidate = CompletionItem & { documentId?: string };

export const completionPolicyWeights = Object.freeze({
  referenced: 640,
  edited: 1280,
  open: 320,
  usage: 480,
  maxUsage: 1600,
  filePrior: 320,
});

/** Policy only: native remains the sole lexical matcher and top-k owner. */
export function rankCompletionCandidates<T extends CompletionRankCandidate>(
  items: readonly T[],
  context: CompletionContext = {},
  usage: ReadonlyMap<string, number> = new Map(),
  options: { emptyQuery?: boolean } = {},
): T[] {
  const referenced = new Set(context.referencedPaths);
  const edited = new Set(context.editedPaths);
  const open = new Set(context.openPaths);
  return items
    .map((item, index) => {
      const path = item.info;
      const rawUsage =
        usage.get(
          completionUsageId(item.kind, item.documentId ?? item.label),
        ) ?? 0;
      const usageCount = Number.isFinite(rawUsage) ? Math.max(0, rawUsage) : 0;
      const contextBoost =
        (path && referenced.has(path)
          ? completionPolicyWeights.referenced
          : 0) +
        (path && edited.has(path) ? completionPolicyWeights.edited : 0) +
        (path && open.has(path) ? completionPolicyWeights.open : 0);
      const usageBoost = Math.round(
        Math.min(
          completionPolicyWeights.maxUsage,
          completionPolicyWeights.usage *
            Math.log2(1 + Math.min(100, usageCount)),
        ),
      );
      const prior =
        !options.emptyQuery &&
        (item.kind === "file" || item.kind === "directory")
          ? completionPolicyWeights.filePrior
          : 0;
      const boost = contextBoost + usageBoost + prior;
      return {
        item: {
          ...item,
          sortScore: (item.sortScore ?? 0) + boost,
          ...(item.scoreFactors
            ? {
                scoreFactors: {
                  ...item.scoreFactors,
                  context: contextBoost,
                  usage: usageBoost,
                  prior,
                },
              }
            : {}),
        },
        usageCount,
        index,
      };
    })
    .sort(
      (a, b) =>
        Number(a.item.available === false) -
          Number(b.item.available === false) ||
        (options.emptyQuery ? b.usageCount - a.usageCount : 0) ||
        b.item.sortScore - a.item.sortScore ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/** Preserve ranked order while preventing any one category crowding out another. */
export function rankCompletionGroups<T extends CompletionRankCandidate>(
  candidates: readonly T[],
  context: CompletionContext,
  usage: ReadonlyMap<string, number>,
  intent: { text: string; kinds?: readonly string[] },
  limit: number,
): { items: T[]; groups: { group: CompletionGroup; more: number }[] } {
  const ranked = rankCompletionCandidates(candidates, context, usage, {
    emptyQuery: !intent.text.trim(),
  });
  const scoped = !!intent.kinds;
  const groupOf = (item: T) =>
    (
      Object.entries(completionGroupKinds) as [
        CompletionGroup,
        readonly string[],
      ][]
    ).find(([, kinds]) => kinds.includes(item.kind))?.[0];
  const cap = scoped ? 12 : 3;
  const shown = new Map<CompletionGroup, number>();
  const totals = new Map<CompletionGroup, number>();
  const items: T[] = [];
  for (const item of ranked) {
    const group = groupOf(item);
    if (!group) continue;
    totals.set(group, (totals.get(group) ?? 0) + 1);
    if ((shown.get(group) ?? 0) >= cap || items.length >= limit) continue;
    shown.set(group, (shown.get(group) ?? 0) + 1);
    items.push(item);
  }
  return {
    items,
    groups: [...totals].map(([group, total]) => ({
      group,
      more: total - (shown.get(group) ?? 0),
    })),
  };
}
