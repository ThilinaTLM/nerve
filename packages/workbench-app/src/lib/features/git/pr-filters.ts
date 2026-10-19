export type GitPrFilterConfig = {
  readonly author: "any" | "me" | "username";
  readonly username: string;
  /** Only PRs awaiting my review (GitHub `review-requested:@me`). */
  readonly reviewRequested: boolean;
  readonly drafts: "include" | "exclude" | "only";
  readonly title: string;
  readonly currentBranchOnly: boolean;
  readonly labels: readonly string[];
  readonly sort: "updated-desc" | "updated-asc";
};

export const defaultGitPrFilterConfig: GitPrFilterConfig = {
  author: "any",
  username: "",
  reviewRequested: false,
  drafts: "include",
  title: "",
  currentBranchOnly: false,
  labels: [],
  sort: "updated-desc",
};

export type GitPrFilterDraft = Omit<GitPrFilterConfig, "labels"> & {
  labels: string;
};

export function normalizeGitPrFilterConfig(
  filters: GitPrFilterConfig,
): GitPrFilterConfig {
  const labels = [...new Set(filters.labels.map((label) => label.trim()))]
    .filter(Boolean)
    .slice(0, 20);
  return {
    author: filters.author,
    username: filters.username.trim(),
    // Configs saved before this field existed have it undefined.
    reviewRequested: filters.reviewRequested === true,
    drafts: filters.drafts,
    title: filters.title.trim(),
    currentBranchOnly: filters.currentBranchOnly,
    labels,
    sort: filters.sort,
  };
}

export function createGitPrFilterDraft(
  filters: GitPrFilterConfig,
): GitPrFilterDraft {
  const normalized = normalizeGitPrFilterConfig(filters);
  return {
    ...normalized,
    labels: normalized.labels.join(", "),
  };
}

export function applyGitPrFilterDraft(
  draft: GitPrFilterDraft,
  hasCurrentBranch: boolean,
): GitPrFilterConfig {
  return normalizeGitPrFilterConfig({
    ...draft,
    currentBranchOnly: hasCurrentBranch && draft.currentBranchOnly,
    labels: draft.labels.split(","),
  });
}

export function gitPrFilterConfigsEqual(
  left: GitPrFilterConfig,
  right: GitPrFilterConfig,
): boolean {
  const normalizedLeft = normalizeGitPrFilterConfig(left);
  const normalizedRight = normalizeGitPrFilterConfig(right);
  return (
    normalizedLeft.author === normalizedRight.author &&
    normalizedLeft.username === normalizedRight.username &&
    normalizedLeft.reviewRequested === normalizedRight.reviewRequested &&
    normalizedLeft.drafts === normalizedRight.drafts &&
    normalizedLeft.title === normalizedRight.title &&
    normalizedLeft.currentBranchOnly === normalizedRight.currentBranchOnly &&
    normalizedLeft.sort === normalizedRight.sort &&
    normalizedLeft.labels.length === normalizedRight.labels.length &&
    normalizedLeft.labels.every(
      (label, index) => label === normalizedRight.labels[index],
    )
  );
}

export function activeGitPrFilterCount(filters: GitPrFilterConfig): number {
  const normalized = normalizeGitPrFilterConfig(filters);
  return (
    Number(normalized.author !== defaultGitPrFilterConfig.author) +
    Number(normalized.reviewRequested) +
    Number(normalized.drafts !== defaultGitPrFilterConfig.drafts) +
    Number(normalized.title.length > 0) +
    Number(normalized.currentBranchOnly) +
    normalized.labels.length +
    Number(normalized.sort !== defaultGitPrFilterConfig.sort)
  );
}

export function hasActiveGitPrFilters(filters: GitPrFilterConfig): boolean {
  const normalized = normalizeGitPrFilterConfig(filters);
  return (
    normalized.author !== defaultGitPrFilterConfig.author ||
    normalized.reviewRequested ||
    normalized.drafts !== defaultGitPrFilterConfig.drafts ||
    normalized.title !== defaultGitPrFilterConfig.title ||
    normalized.currentBranchOnly ||
    normalized.labels.length > 0 ||
    normalized.sort !== defaultGitPrFilterConfig.sort
  );
}

export type GitPrQuickFilter = "all" | "mine" | "review";

/**
 * The quick filter is a shortcut over exactly two fields of the same config
 * the advanced dialog edits: `author` and `reviewRequested`. Picking a quick
 * filter rewrites only those two (all, drafts, title, ... are kept), and the
 * quick filter shows a selection only when those two fields match one preset
 * exactly. A dialog state outside the presets (a username author, or "me" plus
 * review requested) leaves the group unselected, so they never disagree.
 */
export function quickGitPrFilter(
  filters: GitPrFilterConfig,
): GitPrQuickFilter | undefined {
  const { author, reviewRequested } = normalizeGitPrFilterConfig(filters);
  if (author === "any") return reviewRequested ? "review" : "all";
  if (author === "me" && !reviewRequested) return "mine";
  return undefined;
}

export function applyQuickGitPrFilter(
  filters: GitPrFilterConfig,
  quick: GitPrQuickFilter,
): GitPrFilterConfig {
  return normalizeGitPrFilterConfig({
    ...filters,
    author: quick === "mine" ? "me" : "any",
    reviewRequested: quick === "review",
  });
}

/** Pins the PR of the checked-out branch first, keeping the rest in order. */
export function pinCurrentBranchPr<T extends { headRefName: string }>(
  prs: readonly T[],
  currentBranch: string | null | undefined,
): { pinned: T | undefined; ordered: T[] } {
  const pinned = currentBranch
    ? prs.find((pr) => pr.headRefName === currentBranch)
    : undefined;
  return {
    pinned,
    ordered: pinned ? [pinned, ...prs.filter((pr) => pr !== pinned)] : [...prs],
  };
}
