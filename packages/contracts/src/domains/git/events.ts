import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { githubPrSyncStatusSchema } from "./git.js";

const repositoryScope = ["projectId", "repo"] as const;

export const gitEventDefinitions = [
  definePublicEvent(
    "git.repository.changed",
    z.object({
      projectId: z.string().startsWith("proj_").optional(),
      repo: z.string().min(1).max(1_024),
      reason: z.string().min(1).max(128),
      head: z
        .object({
          branch: z.string().max(256).optional(),
          oid: z.string().max(128).optional(),
        })
        .optional(),
    }),
    { scope: repositoryScope },
  ),
  definePublicEvent(
    "git.repository.invalidated",
    z.object({
      projectId: z.string().startsWith("proj_"),
      repo: z.string().min(1).max(1_024),
      generation: z.number().int().nonnegative(),
      fullRefreshRequired: z.boolean(),
      /** Poll uncertainty, not evidence of a filesystem change. Absent means hard invalidation. */
      refreshCause: z.literal("uncertain_poll").optional(),
    }),
    {
      delivery: "ephemeral",
      coalescing: { strategy: "latest_by_scope" },
      scope: repositoryScope,
    },
  ),
  /** Snapshot changed; clients re-read `github.pr.snapshot.get` (memory only). */
  definePublicEvent(
    "github.pr.changed",
    z.object({
      projectId: z.string().startsWith("proj_"),
      repo: z.string().min(1).max(1_024),
      revision: z.number().int().nonnegative(),
      /** PRs whose summary or checks changed. */
      changed: z.array(z.number().int().positive()).max(200),
      removed: z.array(z.number().int().positive()).max(200),
      /** Subset of `changed` where only checks changed. */
      checksChanged: z.array(z.number().int().positive()).max(200),
      status: githubPrSyncStatusSchema,
    }),
    {
      delivery: "ephemeral",
      coalescing: { strategy: "latest_by_scope" },
      scope: repositoryScope,
    },
  ),
];
