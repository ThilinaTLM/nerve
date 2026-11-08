import { z } from "zod";
import {
  gitFileChangeSchema,
  gitMutationResponseSchema,
  gitProjectReadErrorSchema,
  gitRepoSummarySchema,
  gitStashEntrySchema,
} from "./git.js";

/**
 * Server-owned Git workspace store (memory only). Clients declare demand with
 * `git.workspace.watch.sync`, are pinged with `git.workspace.changed`, and read
 * `git.workspace.snapshot.get` / `git.repo.detail.get`.
 *
 * One monotonic `revision` per project covers every change (summaries and
 * details). A detail snapshot's `revision` is the project revision at which
 * that repository's detail last changed.
 */

const projectIdSchema = z.string().startsWith("proj_");
const repoPathSchema = z.string().min(1).max(1_024);
const revisionSchema = z.number().int().nonnegative();

export const gitWorkspaceWatchSyncRequestSchema = z.object({
  projectId: projectIdSchema,
  /** Keep summaries of every repository in the project live. */
  visible: z.boolean(),
  /** Worktrees whose files and stashes are shown or needed (selected, open diffs). */
  detail: z.array(repoPathSchema).max(4).optional(),
  /** "May select soon" (hover, focus): warms detail at low priority. */
  hint: repoPathSchema.optional(),
});
export type GitWorkspaceWatchSyncRequest = z.infer<
  typeof gitWorkspaceWatchSyncRequestSchema
>;

export const gitWorkspaceWatchClearRequestSchema = z.object({
  projectId: projectIdSchema,
});

export const gitWorkspaceWatchStateSchema = z.object({
  /** Current project revision at the time of the call. */
  revision: revisionSchema,
  /** True when the native monitor could not watch some scope reliably (slow fallback poll). */
  degraded: z.boolean(),
});
export type GitWorkspaceWatchState = z.infer<
  typeof gitWorkspaceWatchStateSchema
>;

export const gitWorkspaceSnapshotRequestSchema = z.object({
  projectId: projectIdSchema,
});

export const gitWorkspaceSnapshotSchema = z.object({
  projectId: projectIdSchema,
  revision: revisionSchema,
  /** False until the first discovery completed (summaries are empty then). */
  loaded: z.boolean(),
  projectIsRepo: z.boolean(),
  /** One summary per repository or worktree, sorted by `relativePath`. */
  summaries: z.array(gitRepoSummarySchema),
  errors: z.array(gitProjectReadErrorSchema),
  /** Checkouts outside the project per `worktreeGroup`; omitted groups have none. */
  outsideWorktrees: z
    .array(
      z.object({
        worktreeGroup: z.string(),
        count: z.number().int().positive(),
      }),
    )
    .optional(),
  /** Some content is known to be out of date (dirty, failed refresh or uncertain monitor). */
  stale: z.boolean(),
  /** Repositories whose summary is known to be out of date. */
  staleRepos: z.array(repoPathSchema),
});
export type GitWorkspaceSnapshot = z.infer<typeof gitWorkspaceSnapshotSchema>;

export const gitRepoDetailRequestSchema = z.object({
  projectId: projectIdSchema,
  repo: repoPathSchema.default("."),
});

export const gitRepoDetailSnapshotSchema = z.object({
  projectId: projectIdSchema,
  repo: repoPathSchema,
  revision: revisionSchema,
  files: z.array(gitFileChangeSchema),
  stagedCount: z.number().int().nonnegative(),
  unstagedCount: z.number().int().nonnegative(),
  untrackedCount: z.number().int().nonnegative(),
  stashes: z.array(gitStashEntrySchema),
  stale: z.boolean(),
});
export type GitRepoDetailSnapshot = z.infer<typeof gitRepoDetailSnapshotSchema>;

export const gitWorkspaceRefreshRequestSchema = z.object({
  projectId: projectIdSchema,
  /** Omit to refresh discovery and every demanded repository. */
  repo: repoPathSchema.optional(),
  /** Bypass debounce and read immediately. */
  force: z.boolean().default(true),
});

export const gitWorkspaceRefreshResponseSchema = z.object({
  revision: revisionSchema,
});

/** Mutation result carrying the workspace revision that includes its effect. */
export const gitWorkspaceMutationResponseSchema =
  gitMutationResponseSchema.extend({
    workspaceRevision: revisionSchema.optional(),
  });
export type GitWorkspaceMutationResponse = z.infer<
  typeof gitWorkspaceMutationResponseSchema
>;

export const gitWorkspaceChangedEventSchema = z.object({
  projectId: projectIdSchema,
  revision: revisionSchema,
  /** Repositories whose summary changed (or that were added or removed). */
  repos: z.array(repoPathSchema).max(512),
  /** Repositories whose detail changed. */
  detail: z.array(repoPathSchema).max(512),
});
export type GitWorkspaceChangedEvent = z.infer<
  typeof gitWorkspaceChangedEventSchema
>;
