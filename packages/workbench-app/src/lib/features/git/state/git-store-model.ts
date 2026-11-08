import type {
  GitWorkspaceChangedEvent,
  GitWorkspaceWatchSyncRequest,
} from "@nervekit/contracts/git";

/** Pure rules of the server-owned Git workspace store (see `git-store.svelte.ts`). */

/** Equal revisions are accepted: `stale` can change without a content change. */
export function acceptRevision<T extends { revision: number }>(
  current: T | undefined,
  incoming: T,
): T {
  return current && current.revision > incoming.revision ? current : incoming;
}

export type GitInterest = GitWorkspaceWatchSyncRequest;

/** Server cap on detail repositories per connection and project. */
export const MAX_DETAIL_REPOS = 4;

/** What this client asks the server to keep live for one project. */
export function mergeGitInterests(
  interests: readonly GitInterest[],
  pageVisible: boolean,
): GitInterest | undefined {
  const first = interests[0];
  if (!first) return undefined;
  if (!pageVisible) return { projectId: first.projectId, visible: false };
  const detail = [
    ...new Set(interests.flatMap((interest) => interest.detail ?? [])),
  ].slice(0, MAX_DETAIL_REPOS);
  const hint = interests.find(
    (interest) => interest.hint && !detail.includes(interest.hint),
  )?.hint;
  return {
    projectId: first.projectId,
    visible: interests.some((interest) => interest.visible),
    ...(detail.length ? { detail } : {}),
    ...(hint ? { hint } : {}),
  };
}

/** A request that releases all demand is a clear. */
export function isEmptyGitInterest(interest: GitInterest): boolean {
  return !interest.visible && !interest.detail?.length && !interest.hint;
}

export type GitHeldState = {
  snapshotRevision?: number;
  /** Revision of every detail snapshot held for the project, by repository. */
  detailRevisions: Readonly<Record<string, number>>;
};

export type GitEventReads = { snapshot: boolean; details: string[] };

/**
 * Which reads a `git.workspace.changed` ping requires. Details are only
 * re-read for repositories the client holds; a repository selected later is
 * read when its demand is delivered.
 */
export function planEventReads(
  event: Pick<GitWorkspaceChangedEvent, "revision" | "repos" | "detail">,
  held: GitHeldState,
): GitEventReads {
  return {
    snapshot:
      event.repos.length > 0 &&
      (held.snapshotRevision === undefined ||
        held.snapshotRevision < event.revision),
    details: event.detail.filter((repo) => {
      const revision = held.detailRevisions[repo];
      return revision !== undefined && revision < event.revision;
    }),
  };
}

/** Mutations wait for the workspace revision that includes their effect. */
export function needsRevisionWait(
  applied: number | undefined,
  wanted: number | undefined,
): boolean {
  return wanted !== undefined && (applied ?? -1) < wanted;
}

/**
 * A read whose result is never older than the call that asked for it. Calls
 * made while a read runs share exactly one follow-up read, so an event burst
 * costs at most two reads.
 */
export class CoalescedRead {
  private running: Promise<void> | undefined;
  private queued: Promise<void> | undefined;

  constructor(private readonly run: () => Promise<void>) {}

  fresh(): Promise<void> {
    if (!this.running) return this.start();
    this.queued ??= this.running
      .catch(() => undefined)
      .then(() => {
        this.queued = undefined;
        return this.start();
      });
    return this.queued;
  }

  private start(): Promise<void> {
    const read: Promise<void> = this.run().finally(() => {
      if (this.running === read) this.running = undefined;
    });
    this.running = read;
    return read;
  }
}
