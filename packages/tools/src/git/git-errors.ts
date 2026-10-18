export type GitCommandFailureCategory =
  | "local-changes"
  | "untracked-files"
  | "unmerged-files"
  | "non-fast-forward"
  | "branch-not-merged"
  | "timeout";

/** Classify only known Git diagnostics, never arbitrary Error messages. */
function commandFailureCategory(
  stderr: string,
): GitCommandFailureCategory | undefined {
  if (
    /^error: Your local changes to the following files would be overwritten by (?:checkout|merge):\r?$/m.test(
      stderr,
    )
  )
    return "local-changes";
  if (
    /^error: The following untracked working tree files would be overwritten by (?:checkout|merge):\r?$/m.test(
      stderr,
    )
  )
    return "untracked-files";
  if (
    /^(?:error: you need to resolve your current index first|error: (?:Pulling|Merging) is not possible because you have unmerged files\.)\r?$/m.test(
      stderr,
    )
  )
    return "unmerged-files";
  if (/^fatal: Not possible to fast-forward, aborting\.\r?$/m.test(stderr))
    return "non-fast-forward";
  if (/^error: [Bb]ranch '.+' is not fully merged\.\r?$/m.test(stderr))
    return "branch-not-merged";
  return undefined;
}

export class GitCommandError extends Error {
  readonly failureCategory: GitCommandFailureCategory | undefined;

  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout = "",
    failureCategory?: GitCommandFailureCategory,
  ) {
    super(stderr.trim() || `${command} failed`);
    this.name = "GitCommandError";
    this.failureCategory = failureCategory ?? commandFailureCategory(stderr);
  }
}

export class GitWorkflowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitWorkflowError";
  }
}
