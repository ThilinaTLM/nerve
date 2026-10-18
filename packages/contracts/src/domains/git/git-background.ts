import { z } from "zod";
import { githubPrListResponseSchema } from "./git.js";

const scope = z.object({
  projectId: z.string().startsWith("proj_"),
  repo: z.string().min(1).max(1024).default("."),
});
export const gitOperationStartRequestSchema = z.discriminatedUnion("kind", [
  scope.extend({ kind: z.enum(["fetch", "pull", "push", "sync"]) }),
  scope.extend({
    kind: z.literal("switchBaseAndPull"),
    baseBranch: z.string().min(1).optional(),
  }),
  scope.extend({
    kind: z.literal("checkout"),
    number: z.number().int().positive(),
  }),
  scope.extend({
    kind: z.literal("clone"),
    remoteUrl: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (value) => value.trim().length > 0 && !/[\0\r\n]/.test(value),
        "Invalid clone remote",
      ),
  }),
]);
export type GitOperationStartRequest = z.infer<
  typeof gitOperationStartRequestSchema
>;
const operationLabels = {
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
  sync: "Sync",
  switchBaseAndPull: "Switch to base and pull",
  checkout: "Check out PR",
  clone: "Clone",
} as const;

/** Human-facing titles include only operation/repository scope, never a remote URL. */
export function gitOperationTitle(
  input: Pick<GitOperationStartRequest, "kind" | "repo"> & { number?: number },
): string {
  const label = operationLabels[input.kind];
  return `${label}${input.kind === "checkout" && input.number ? ` #${input.number}` : ""} · ${input.repo}`;
}
export function gitBulkOperationTitle(
  kind: GitOperationBulkStartRequest["kind"],
): string {
  return `${operationLabels[kind]} all repositories`;
}

export const gitOperationStartResponseSchema = z.object({
  operationId: z.string().min(1),
});
export type GitOperationStartResponse = z.infer<
  typeof gitOperationStartResponseSchema
>;
export const gitOperationCancelRequestSchema = z.object({
  operationId: z.string().min(1),
});
export const gitOperationCancelResponseSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().optional(),
});
export const gitOperationBulkStartRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  repos: z.array(z.string().min(1).max(1024)).min(1).max(100),
  kind: z.enum(["fetch", "pull", "switchBaseAndPull"]),
});
export type GitOperationBulkStartRequest = z.infer<
  typeof gitOperationBulkStartRequestSchema
>;
export const gitOperationBulkStartResponseSchema =
  gitOperationStartResponseSchema.extend({
    childOperationIds: z.array(z.string()).max(100),
  });
export type GitOperationBulkStartResponse = z.infer<
  typeof gitOperationBulkStartResponseSchema
>;

export const githubCachedListRequestSchema = scope.extend({
  refresh: z.boolean().default(false),
});
export type GithubCachedListRequest = z.infer<
  typeof githubCachedListRequestSchema
>;
export const githubIssueSummarySchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1000),
  url: z.string().url().max(2048),
  state: z.enum(["OPEN", "CLOSED"]),
  updatedAt: z.string().datetime(),
  author: z.string().max(100).nullable(),
});
export type GithubIssueSummary = z.infer<typeof githubIssueSummarySchema>;
export const githubCacheStatusSchema = z.enum([
  "loading",
  "fresh",
  "stale",
  "unavailable",
]);
export type GithubCacheStatus = z.infer<typeof githubCacheStatusSchema>;
const freshness = z.object({
  status: githubCacheStatusSchema,
  refreshing: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export const githubIssueListResponseSchema = freshness.extend({
  issues: z.array(githubIssueSummarySchema).max(100),
});
export type GithubIssueListResponse = z.infer<
  typeof githubIssueListResponseSchema
>;
export const githubPrCachedListResponseSchema = freshness.extend({
  result: githubPrListResponseSchema
    .extend({ prs: githubPrListResponseSchema.shape.prs.max(100) })
    .nullable(),
});
export type GithubPrCachedListResponse = z.infer<
  typeof githubPrCachedListResponseSchema
>;
