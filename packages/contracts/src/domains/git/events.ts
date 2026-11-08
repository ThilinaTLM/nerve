import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { githubPrSyncStatusSchema } from "./git.js";
import { gitWorkspaceChangedEventSchema } from "./git-workspace.js";

const repositoryScope = ["projectId", "repo"] as const;

export const gitEventDefinitions = [
  /** Workspace content changed; clients re-read `git.workspace.snapshot.get` / `git.repo.detail.get`. */
  definePublicEvent("git.workspace.changed", gitWorkspaceChangedEventSchema, {
    delivery: "ephemeral",
    scope: ["projectId"],
  }),
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
