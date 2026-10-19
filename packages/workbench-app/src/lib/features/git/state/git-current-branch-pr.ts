import type { GithubPr, GithubPrHeadSummary } from "@nervekit/contracts/git";

export function currentBranchPrHead(
  branch: string | undefined,
  heads: readonly GithubPrHeadSummary[],
): GithubPrHeadSummary | undefined {
  if (!branch) return undefined;
  return heads
    .filter((pr) => pr.headRefName === branch)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

/** The loaded list may be filtered; only reuse an exact, still-open match. */
export async function resolveCurrentBranchPr(
  head: GithubPrHeadSummary,
  loaded: readonly GithubPr[],
  fetch: () => Promise<readonly GithubPr[]>,
): Promise<GithubPr | undefined> {
  const matches = (pr: GithubPr) =>
    pr.number === head.number && pr.state.toLowerCase() === "open";
  return loaded.find(matches) ?? (await fetch()).find(matches);
}
