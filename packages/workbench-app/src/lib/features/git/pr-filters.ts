export type GitPrFilterConfig = {
  readonly author: "any" | "me" | "username";
  readonly username: string;
  readonly drafts: "include" | "exclude" | "only";
  readonly title: string;
  readonly currentBranchOnly: boolean;
  readonly labels: readonly string[];
  readonly sort: "updated-desc" | "updated-asc";
};

export const defaultGitPrFilterConfig: GitPrFilterConfig = {
  author: "any",
  username: "",
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
    normalized.drafts !== defaultGitPrFilterConfig.drafts ||
    normalized.title !== defaultGitPrFilterConfig.title ||
    normalized.currentBranchOnly ||
    normalized.labels.length > 0 ||
    normalized.sort !== defaultGitPrFilterConfig.sort
  );
}
