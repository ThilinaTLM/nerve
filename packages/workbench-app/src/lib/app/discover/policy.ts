import type { ResolvedGuide } from "./guides/catalog-policy.js";
import type {
  DiscoverEditorialDefinition,
  DiscoverEditorialId,
} from "./catalog.js";
import type { DiscoverSeenVersions } from "./progress.js";

export type ResolvedDiscoverEditorial = DiscoverEditorialDefinition & {
  unseen: boolean;
};
export type ResolvedDiscoverHighlight = Extract<
  DiscoverEditorialDefinition,
  { kind: "highlight" }
> & { unseen: boolean };

export type DiscoverSections = {
  startHere: ResolvedGuide[];
  highlights: ResolvedDiscoverHighlight[];
  tips: ResolvedDiscoverEditorial[];
  completed: ResolvedGuide[];
};

const priorityRank = {
  "must-do": 0,
  "highly-recommended": 1,
  optional: 2,
} as const;

export function resolveDiscoverEditorial(
  definitions: readonly DiscoverEditorialDefinition[],
  seen: DiscoverSeenVersions,
): ResolvedDiscoverEditorial[] {
  return definitions.map((item) => ({
    ...item,
    unseen: (seen[item.id as DiscoverEditorialId] ?? 0) < item.version,
  }));
}

export function buildDiscoverSections(
  guides: readonly ResolvedGuide[],
  editorial: readonly ResolvedDiscoverEditorial[],
): DiscoverSections {
  const availableGuides = guides.filter((guide) => guide.available);
  const startHere = availableGuides
    .filter((guide) => !guide.completed)
    .sort(
      (left, right) =>
        priorityRank[left.priority] - priorityRank[right.priority],
    );
  const highlights = editorial
    .filter(
      (item): item is ResolvedDiscoverHighlight => item.kind === "highlight",
    )
    .sort(
      (left, right) =>
        Number(right.featured) - Number(left.featured) ||
        Number(right.unseen) - Number(left.unseen),
    );
  const tips = editorial
    .filter((item) => item.kind === "tip")
    .sort((left, right) => Number(right.unseen) - Number(left.unseen));
  const completed = availableGuides.filter((guide) => guide.completed);
  return {
    startHere,
    highlights,
    tips,
    completed,
  };
}

export function unseenEditorialCount(
  editorial: readonly ResolvedDiscoverEditorial[],
): number {
  return editorial.filter((item) => item.unseen).length;
}

export function discoverAttentionCount(input: {
  incompleteGuideCount: number;
  unseenEditorialCount: number;
}): number {
  return input.incompleteGuideCount + input.unseenEditorialCount;
}

export function shouldOpenDiscoverOnStartup(input: {
  progressiveActive: boolean;
  settingsLoaded: boolean;
  generation: number;
  consideredGeneration?: number;
}): boolean {
  return (
    input.progressiveActive &&
    input.settingsLoaded &&
    input.consideredGeneration !== input.generation
  );
}
