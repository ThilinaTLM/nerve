/**
 * Linked worktrees live at `<project dir>/.worktrees/<id>`. The id is derived
 * from the branch name; client (preview) and server (default) share the rule.
 */
export const WORKTREES_DIRECTORY = ".worktrees";

const MAX_WORKTREE_ID_LENGTH = 100;

const isEdge = (char: string | undefined) => char === "-" || char === ".";

/**
 * Drops leading and trailing `-`/`.` with an index scan: an anchored
 * `[-.]+$` regex backtracks quadratically on long inner runs (ReDoS).
 */
function trimEdges(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isEdge(text[start])) start++;
  while (end > start && isEdge(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Lowercase; runs outside `[a-z0-9._-]` become `-`; no leading/trailing `-` or `.`. */
export function worktreeSlug(text: string): string {
  const slug = trimEdges(
    text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-"),
  );
  return trimEdges(slug.slice(0, MAX_WORKTREE_ID_LENGTH));
}

/**
 * Default id for a branch. Projects with several repositories prefix the
 * repository name so ids of different repositories never collide.
 */
export function worktreeIdFromBranch(
  branch: string,
  options: { repoName?: string; multiRepo?: boolean } = {},
): string {
  const base = worktreeSlug(branch);
  if (!base) return "";
  const prefix =
    options.multiRepo && options.repoName ? worktreeSlug(options.repoName) : "";
  return prefix ? worktreeSlug(`${prefix}-${base}`) : base;
}

export function isValidWorktreeId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_WORKTREE_ID_LENGTH &&
    /^[a-z0-9][a-z0-9._-]*$/.test(id) &&
    !id.endsWith(".")
  );
}

/** First free id: `id`, then `id-2`, `id-3`, ... against taken folder names. */
export function uniqueWorktreeId(
  id: string,
  taken: ReadonlySet<string>,
): string {
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`;
  return candidate;
}
