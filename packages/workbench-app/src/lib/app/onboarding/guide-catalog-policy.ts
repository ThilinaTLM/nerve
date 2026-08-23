import type {
  GuideCompletionSignal,
  GuideDefinition,
  GuideId,
} from "./guide-catalog.js";
import type { GuideCompletionVersions } from "./guide-completion.js";

export type GuideSignals = Record<GuideCompletionSignal, boolean>;

export type ResolvedGuide = GuideDefinition & {
  completed: boolean;
  ready: boolean | undefined;
  available: boolean;
};

export function resolveGuide(
  guide: GuideDefinition,
  versions: GuideCompletionVersions,
  signals: GuideSignals,
): ResolvedGuide {
  const ready = guide.completionSignal
    ? signals[guide.completionSignal]
    : undefined;
  return {
    ...guide,
    available: guide.lifecycle !== "upcoming",
    ready,
    completed: (versions[guide.id] ?? 0) >= guide.version || ready === true,
  };
}

export function resolveGuides(
  guides: readonly GuideDefinition[],
  versions: GuideCompletionVersions,
  signals: GuideSignals,
): ResolvedGuide[] {
  return guides.map((guide) => resolveGuide(guide, versions, signals));
}

export function autoCompletedGuideIds(
  guides: readonly ResolvedGuide[],
  versions: GuideCompletionVersions,
): GuideId[] {
  return guides
    .filter(
      (guide) =>
        guide.available &&
        guide.ready === true &&
        (versions[guide.id] ?? 0) < guide.version,
    )
    .map((guide) => guide.id);
}

export function incompleteGuideCount(guides: readonly ResolvedGuide[]): number {
  return guides.filter((guide) => guide.available && !guide.completed).length;
}
