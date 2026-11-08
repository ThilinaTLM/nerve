import type { GithubPr } from "@nervekit/contracts/git";

/** Menu configuration, one per project: drafts, labels and sort. */
export type GitPrFilterConfig = {
  readonly drafts: "include" | "exclude" | "only";
  readonly labels: readonly string[];
  readonly sort: "updated-desc" | "updated-asc";
};

export const defaultGitPrFilterConfig: GitPrFilterConfig = {
  drafts: "include",
  labels: [],
  sort: "updated-desc",
};

export type GitPrQuickFilter = "all" | "mine" | "review";

export type GitPrFilterDraft = Omit<GitPrFilterConfig, "labels"> & {
  labels: string;
};

export function normalizeGitPrFilterConfig(
  filters: GitPrFilterConfig,
): GitPrFilterConfig {
  const labels = [...new Set(filters.labels.map((label) => label.trim()))]
    .filter(Boolean)
    .slice(0, 20);
  return { drafts: filters.drafts, labels, sort: filters.sort };
}

export function createGitPrFilterDraft(
  filters: GitPrFilterConfig,
): GitPrFilterDraft {
  const normalized = normalizeGitPrFilterConfig(filters);
  return { ...normalized, labels: normalized.labels.join(", ") };
}

export function applyGitPrFilterDraft(
  draft: GitPrFilterDraft,
): GitPrFilterConfig {
  return normalizeGitPrFilterConfig({
    ...draft,
    labels: draft.labels.split(","),
  });
}

export function gitPrFilterConfigsEqual(
  left: GitPrFilterConfig,
  right: GitPrFilterConfig,
): boolean {
  const a = normalizeGitPrFilterConfig(left);
  const b = normalizeGitPrFilterConfig(right);
  return (
    a.drafts === b.drafts &&
    a.sort === b.sort &&
    a.labels.length === b.labels.length &&
    a.labels.every((label, index) => label === b.labels[index])
  );
}

export function activeGitPrFilterCount(filters: GitPrFilterConfig): number {
  const normalized = normalizeGitPrFilterConfig(filters);
  return (
    Number(normalized.drafts !== defaultGitPrFilterConfig.drafts) +
    normalized.labels.length +
    Number(normalized.sort !== defaultGitPrFilterConfig.sort)
  );
}

export function hasActiveGitPrFilters(filters: GitPrFilterConfig): boolean {
  return activeGitPrFilterCount(filters) > 0;
}

type SearchablePr = Pick<
  GithubPr,
  "title" | "number" | "author" | "headRefName"
>;

/**
 * Case-insensitive search over repository name, title, number (with or without
 * `#`, prefix match), author login and head branch. Every word must match some
 * field; an empty query matches everything.
 */
export function matchesGitPrSearch(
  query: string,
  repositoryName: string,
  pr: SearchablePr,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const fields = [
    repositoryName,
    pr.title,
    pr.author ?? "",
    pr.headRefName,
  ].map((field) => field.toLowerCase());
  const number = String(pr.number);
  return words.every((word) => {
    if (fields.some((field) => field.includes(word))) return true;
    const digits = word.startsWith("#") ? word.slice(1) : word;
    return /^\d*$/.test(digits) && number.startsWith(digits);
  });
}

/** One GitHub repository (owner/name) shown once in the list. */
export type GitPrRepositorySource = {
  /** Lowercase `owner/name`. */
  readonly key: string;
  /** Repository name for display and search. */
  readonly name: string;
  /** Primary checkout path used to open PRs. */
  readonly repository: string;
  readonly prs: readonly GithubPr[];
  readonly viewer: string | null;
  /** Head branches checked out in any local worktree of this repository. */
  readonly checkedOutBranches: ReadonlySet<string>;
};

export type GitPrRepositoryGroup = {
  readonly key: string;
  readonly name: string;
  readonly repository: string;
  readonly prs: readonly (GithubPr & { checkedOut: boolean })[];
};

export type GitPrListOptions = {
  readonly query: string;
  readonly quick: GitPrQuickFilter;
  readonly filters: GitPrFilterConfig;
};

/** Distinct labels of the open PRs, sorted case-insensitively. */
export function availableGitPrLabels(
  sources: readonly GitPrRepositorySource[],
): string[] {
  const labels = new Map<string, string>();
  for (const source of sources)
    for (const pr of source.prs)
      for (const label of pr.labels)
        if (!labels.has(label.toLowerCase()))
          labels.set(label.toLowerCase(), label);
  return [...labels.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * Filters, searches and orders PRs per repository. Repositories sort by name;
 * inside one, PRs checked out locally come first, then the configured order.
 * Repositories without matches are omitted.
 */
export function groupGitPrsByRepository(
  sources: readonly GitPrRepositorySource[],
  options: GitPrListOptions,
): GitPrRepositoryGroup[] {
  const filters = normalizeGitPrFilterConfig(options.filters);
  const direction = filters.sort === "updated-asc" ? 1 : -1;
  const groups: GitPrRepositoryGroup[] = [];
  for (const source of sources) {
    const viewer = source.viewer?.toLowerCase();
    const prs = source.prs
      .filter(
        (pr) =>
          pr.state === "OPEN" &&
          (filters.drafts === "include" ||
            (filters.drafts === "only" ? pr.isDraft : !pr.isDraft)) &&
          filters.labels.every((label) =>
            pr.labels.some(
              (candidate) => candidate.toLowerCase() === label.toLowerCase(),
            ),
          ) &&
          (options.quick === "all" ||
            (options.quick === "mine"
              ? Boolean(viewer && pr.author?.toLowerCase() === viewer)
              : pr.reviewRequested)) &&
          matchesGitPrSearch(options.query, source.name, pr),
      )
      .map((pr) => ({
        ...pr,
        checkedOut: source.checkedOutBranches.has(pr.headRefName),
      }))
      .sort(
        (a, b) =>
          Number(b.checkedOut) - Number(a.checkedOut) ||
          direction * a.updatedAt.localeCompare(b.updatedAt) ||
          b.number - a.number,
      );
    if (prs.length > 0)
      groups.push({
        key: source.key,
        name: source.name,
        repository: source.repository,
        prs,
      });
  }
  return groups.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.key.localeCompare(b.key),
  );
}

/** `owner/name` of a GitHub repository URL, or undefined when unparsable. */
export function githubRepositoryKey(
  url: string | null | undefined,
): { key: string; name: string } | undefined {
  if (!url) return undefined;
  try {
    const [owner, name] = new URL(url).pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    return owner && name
      ? { key: `${owner}/${name}`.toLowerCase(), name }
      : undefined;
  } catch {
    return undefined;
  }
}

export type GitPrCheckout = {
  readonly relativePath: string;
  readonly currentBranch: string | null;
  /** Remote URL of the repository once its PR snapshot resolved it. */
  readonly repositoryUrl?: string | null;
};

export type GitPrCheckoutGroup = {
  readonly key: string;
  readonly name: string;
  /** Primary checkout: shallowest path, then alphabetical. */
  readonly repository: string;
  readonly members: readonly string[];
  readonly checkedOutBranches: ReadonlySet<string>;
  /** False while the remote is still unknown (key is the path). */
  readonly resolved: boolean;
};

/**
 * Merges checkouts of one GitHub remote (worktrees, separate clones) by
 * `owner/name`. Checkouts whose remote is not resolved yet stay separate.
 */
export function groupGithubCheckouts(
  checkouts: readonly GitPrCheckout[],
  nameOf: (relativePath: string) => string = (path) => path,
): GitPrCheckoutGroup[] {
  const depth = (path: string) => (path === "." ? 0 : path.split("/").length);
  const byKey = new Map<string, GitPrCheckout[]>();
  const identity = new Map<string, { name: string; resolved: boolean }>();
  for (const checkout of checkouts) {
    const parsed = githubRepositoryKey(checkout.repositoryUrl);
    const key = parsed?.key ?? `path:${checkout.relativePath}`;
    identity.set(key, {
      name: parsed?.name ?? nameOf(checkout.relativePath),
      resolved: Boolean(parsed),
    });
    byKey.set(key, [...(byKey.get(key) ?? []), checkout]);
  }
  return [...byKey].map(([key, members]) => {
    const sorted = [...members].sort(
      (a, b) =>
        depth(a.relativePath) - depth(b.relativePath) ||
        a.relativePath.localeCompare(b.relativePath),
    );
    const info = identity.get(key)!;
    return {
      key,
      name: info.name,
      repository: sorted[0]!.relativePath,
      members: sorted.map((member) => member.relativePath),
      checkedOutBranches: new Set(
        members.flatMap((member) =>
          member.currentBranch ? [member.currentBranch] : [],
        ),
      ),
      resolved: info.resolved,
    };
  });
}
