import type {
  GithubPrSnapshot,
  GithubPrSyncStatus,
} from "@nervekit/contracts/git";
import type { RestCheckRun, RestCommitStatus } from "@nervekit/tools/git";

export type PrEntry = {
  /** `host/owner/name` (lowercase) shared by worktrees and clones; `path:<pathKey>` when no GitHub remote. */
  key: string;
  host: string;
  paths: Map<string, PrPathRef>;
  /** Shared state; `projectId`/`repo` are filled per path when read or published. */
  snapshot: GithubPrSnapshot;
  etag?: string;
  lastProbe: number | null;
  branchRequests: Set<string>;
  fingerprints: Map<number, string>;
  signalAt?: number;
  awaiting: Map<string, number>;
  /** Backoff after non-rate-limit errors; rate limits are shared in the host budget. */
  backoffUntil?: number;
  /** Claimed start of the next probe cycle in the host budget. */
  slot?: number;
  pollIntervalMs?: number;
  timer?: ReturnType<typeof setTimeout>;
  flight?: Promise<void>;
  requested: Set<number>;
  checks: Map<
    string,
    {
      runs?: RestCheckRun[];
      status?: RestCommitStatus;
      runsTag?: string;
      statusTag?: string;
      firstAt: number;
      at: number;
    }
  >;
};
/** A repository path the client or server refers to; bound to the shared entry of its GitHub remote. */
export type PrPathRef = {
  projectId: string;
  repo: string;
  pathKey: string;
  entry?: PrEntry;
  ready: Promise<void>;
  resolvedAt: number;
  resolving: boolean;
  /** Current branch reported by the workspace sync (null: detached or unknown). */
  branch?: string | null;
};
export type PrPublisher = {
  publish(
    type: "github.pr.changed",
    data: {
      projectId: string;
      repo: string;
      revision: number;
      changed: number[];
      removed: number[];
      checksChanged: number[];
      status: GithubPrSyncStatus;
    },
  ): unknown;
};

export const emptyPrSnapshot = (
  projectId: string,
  repo: string,
): GithubPrSnapshot => ({
  projectId,
  repo,
  revision: 0,
  repositoryUrl: null,
  status: "stale",
  updatedAt: null,
  retryAt: null,
  truncated: false,
  viewer: null,
  prs: [],
});
